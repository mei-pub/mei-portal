// service/download —— Go internal/service/download_task.go 的复刻

import fs from "node:fs";
import path from "node:path";
import { extractTorrentMeta } from "../core/bencode.ts";
import {
  resolveTaskDir,
  sanitizeFilename,
  sanitizeFolder,
  taskTmpDir,
} from "../core/downloader.ts";
import { logger } from "../logger.ts";
import type { TaskQueue } from "../core/queue.ts";
import type { DownloadParams } from "../core/types.ts";
import type { TaskLogManager } from "../tasklog.ts";
import type { Video, VideoRepository } from "../db.ts";
import { ENGINE_TYPES, type EngineBridge } from "./engine.ts";
import {
  checkFileExists,
  getPageTitle,
  magnetDisplayName,
  randomName,
} from "./helpers.ts";

export interface AddDownloadTaskInput {
  name: string;
  type: string;
  url: string;
  headers?: string | null;
  folder?: string | null;
  /** BT 种子文件任务的下载文件索引（"1,3-5"；空 = 全部） */
  selectFile?: string | null;
  /** 直链任务分段数（FluxDown 动态分段；0/null = 按大小自动推荐） */
  segments?: number | null;
  /** 归属命名队列（FluxDown daemon.queue；null = 引擎默认 main） */
  queueId?: string | null;
}

/** 引擎任务（FluxDown，direct/bt）实时态（列表行携带；做种/上传/节点数） */
export interface EngineRowInfo {
  uploadSpeed: string;
  uploadedBytes: number;
  seeding: number;
  seedingStatus: number;
  seedingMessage: string;
  seedingTimeSecs: number;
  peers: number | null;
  activeTransfers: number | null;
  downloadedBytes: number;
  totalBytes: number;
}

export interface DownloadTaskWithFile extends Video {
  exists: boolean;
  file?: string;
  engine?: EngineRowInfo;
}

/**
 * aria2c 输出行 → BT 落盘路径（磁力任务回写实际种子名用）。
 * 双来源（实测 aria2 1.36.0，console-log-level=notice + summary-interval=1）：
 * - 进度 summary 的 `FILE: <绝对路径>`（metadata 一拿到就每秒打印，可提前回写；
 *   磁力 metadata 阶段的 `FILE: [MEMORY][METADATA]<dn>` 排除）
 * - 完成时 Download Results 表的 `gid|OK|speed|…|<绝对路径>` 行（split 解析，
 *   对列数不敏感；非 OK/非路径行不返回）
 */
export function aria2BtPathFromLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("FILE: ")) {
    const rest = trimmed.slice(6).trim();
    if (rest.startsWith("[")) return ""; // [MEMORY][METADATA] 占位行
    return rest.split(/\s+/)[0] ?? "";
  }
  const parts = trimmed.split("|").map((s) => s.trim());
  const last = parts[parts.length - 1] ?? "";
  if (parts.length >= 4 && parts[1] === "OK" && last.startsWith("/")) {
    return last;
  }
  return "";
}

/**
 * BT 落盘路径 → 种子名候选（相对任务目录的第一段）：
 * - 单文件种子：localDir/<name>.<ext> → 去扩展名
 * - 多文件种子：localDir/<种子名>/<files…> → 第一段即种子目录名
 */
export function btNameFromPath(file: string, searchDir: string): string {
  const rel = path.relative(searchDir, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  const first = rel.split(path.sep)[0] ?? "";
  const ext = path.extname(first);
  return sanitizeFilename(ext !== "" ? first.slice(0, -ext.length) : first);
}

export class DownloadTaskService {
  private readonly repo: VideoRepository;
  private readonly queue: TaskQueue;
  private readonly logs: TaskLogManager | null;
  private readonly engine: EngineBridge | null;

  constructor(
    repo: VideoRepository,
    queue: TaskQueue,
    logs: TaskLogManager | null,
    engine?: EngineBridge | null,
  ) {
    this.repo = repo;
    this.queue = queue;
    this.logs = logs;
    this.engine = engine ?? null;
  }

  /** 引擎（FluxDown）可用性（设置页/报错提示用） */
  engineBridge(): EngineBridge | null {
    return this.engine;
  }

  /** 创建下载任务：自动标题 + sanitize 后查重重名（重名加随机后缀） */
  async addDownloadTask(input: AddDownloadTaskInput): Promise<Video> {
    return (await this.addDownloadTasks([input]))[0]!;
  }

  async addDownloadTasks(inputs: AddDownloadTaskInput[]): Promise<Video[]> {
    const videos: Array<Omit<Video, "id" | "createdDate" | "updatedDate">> = [];
    for (const input of inputs) {
      let title = input.name;
      if (title === "" && input.type === "bilibili") {
        title = await getPageTitle(input.url, "");
      }
      // 磁力：优先取 dn 参数（download name）作任务名；真实种子名在 metadata
      // 获取后由 noteBtResult 解析 FILE: 行回写。
      // 种子文件：直接读 .torrent 的 info.name 作任务名（上传端点已解析校验过）
      if (title === "" && input.type === "bt") {
        title = magnetDisplayName(input.url) ?? "";
        if (title === "" && /\.torrent$/i.test(input.url)) {
          try {
            title = extractTorrentMeta(fs.readFileSync(input.url)).name;
          } catch (err: any) {
            logger.warn(
              `torrent name extract failed url=${input.url}: ${err?.message ?? err}`,
            );
          }
        }
      }
      if (title === "") {
        title = `untitled-${randomName()}`;
      }
      // sanitize 在查重之前 —— 保证 DB 名 / 下载器参数 / 事后文件检查三处一致
      title = sanitizeFilename(title);
      const existing = this.repo.findByName(title);
      if (existing) {
        title = `${title}-${randomName()}`;
      }
      videos.push({
        name: title,
        type: input.type,
        url: input.url,
        headers: input.headers ?? null,
        // folder 为用户可控：内置 key（bt/files/video）或相对段（影视分类/剧名），
        // 清洗掉 ../ 等穿越段；落盘解析统一走 resolveTaskDir
        folder: input.folder ? sanitizeFolder(input.folder) : null,
        isLive: false,
        status: "ready",
        selectFile: input.selectFile ?? null,
        // 引擎任务 ID：提交到 FluxDown 后回写（service/startDownload → bridge）
        engineTaskId: null,
        // 直链分段数（0/null = 引擎按文件大小自动推荐）
        segments: input.segments ?? null,
        // 归属命名队列（null = 引擎默认 main；引擎为事实源，此处仅建队时透传）
        queueId: input.queueId ?? null,
      });
    }
    return this.repo.createMany(videos);
  }

  editDownloadTask(
    id: number,
    data: { [key: string]: unknown },
  ): Promise<Video> {
    return Promise.resolve(this.repo.update(id, data));
  }

  /** 「创建后未启动」死行回滚删除（无引擎关联才删；级联清理不适用——
   *  尚无产物无关联，仅去掉提交失败留下的失败态噪音行） */
  deleteUnstartedRow(id: number): boolean {
    const row = this.repo.findById(id);
    if (!row || row.engineTaskId) return false;
    this.repo.delete(id);
    return true;
  }

  /** 分页列表（success 任务附带本地文件存在检查） */
  getDownloadTasks(
    current: number,
    pageSize: number,
    filter: string,
    localPath: string,
    type = "",
  ): { total: number; list: DownloadTaskWithFile[] } {
    const result = this.repo.findWithPagination(
      current,
      pageSize,
      filter,
      type,
    );
    const list: DownloadTaskWithFile[] = result.items.map((item) => {
      const withFile: DownloadTaskWithFile = { ...item, exists: false };
      if (item.status === "success" && localPath !== "") {
        // 目录解析唯一规则：内置 key → 下载根/key；其余 localDir+folder
        const searchDir = resolveTaskDir(item.folder, localPath);
        const [exists, file] = checkFileExists(item.name, searchDir);
        withFile.exists = exists;
        if (file !== "") withFile.file = file;
      }
      // 引擎任务（direct/bt）实时态：做种/上传速率/节点数（列表行直接
      // 携带——完成态行不经 /api/tasks 轮询，做种徽标数据从这里来）
      if (ENGINE_TYPES.has(item.type) && this.engine) {
        const rt = this.engine.runtimeOf(item.id);
        if (rt) {
          withFile.engine = {
            uploadSpeed: rt.uploadSpeed,
            uploadedBytes: rt.uploadedBytes,
            seeding: rt.seeding,
            seedingStatus: rt.seeding,
            seedingMessage: rt.seedingMessage,
            seedingTimeSecs: rt.seedingTimeSecs,
            peers: rt.peers ?? null,
            activeTransfers: rt.activeTransfers ?? null,
            downloadedBytes: rt.downloadedBytes,
            totalBytes: rt.totalBytes,
          };
        }
      }
      return withFile;
    });
    return { total: result.total, list };
  }

  /**
   * 启动下载：
   * - 引擎类型（direct/bt）→ FluxDown 引擎：已关联任务恢复（引擎任务
   *   消失则重建），未关联任务按类型提交；状态由引擎事件镜像（首个
   *   taskChanged 落 downloading）
   * - 其余类型（m3u8/bilibili/youtube/mediago）→ 队列 + 外部工具（原路径）
   */
  async startDownload(
    taskID: number,
    _localPath: string,
    _deleteSegments: boolean,
  ): Promise<void> {
    const video = this.repo.findByIdOrFail(taskID);

    if (ENGINE_TYPES.has(video.type) && this.engine) {
      const engine = this.engine;
      this.repo.updateStatus([taskID], "downloading");
      try {
        if (video.engineTaskId) {
          // 已关联引擎：恢复（引擎任务被外部删除时回退重建）
          try {
            await engine.resume(taskID);
            return;
          } catch (err: any) {
            logger.warn(
              `engine resume failed id=${taskID} (${err?.message ?? err}), re-submitting`,
            );
          }
        }
        if (video.type === "bt") {
          await engine.submitBt(
            taskID,
            video.url,
            video.name,
            video.folder,
            video.selectFile,
            video.queueId,
          );
        } else {
          await engine.submitDirect(
            taskID,
            video.url,
            video.name,
            video.folder,
            video.headers,
            video.segments,
            video.queueId,
          );
        }
      } catch (err: any) {
        this.repo.updateStatus([taskID], "failed");
        throw err;
      }
      return;
    }

    this.repo.updateStatus([taskID], "pending");

    let headers: string[] = [];
    if (video.headers && video.headers !== "") {
      try {
        const parsed = JSON.parse(video.headers);
        if (Array.isArray(parsed)) headers = parsed.map(String);
      } catch {
        headers = [];
      }
    }

    const params: DownloadParams = {
      id: String(taskID),
      type: video.type as DownloadParams["type"],
      url: video.url,
      name: video.name,
      // 旧记录可能带未清洗的 folder —— 入队前再洗一次（buildArgs 亦有防御）
      folder: video.folder ? sanitizeFolder(video.folder) : "",
      headers,
    };

    const status = this.queue.enqueue(params);
    if (status === "downloading") {
      this.repo.updateStatus([taskID], "downloading");
    } else if (status === "pending") {
      // 保持 pending
    } else {
      this.repo.updateStatus([taskID], "failed");
    }
  }

  /** 停止任务：引擎类型 = 暂停引擎任务；队列类型 = abort 子进程 */
  stopDownload(id: number): void {
    const task = this.repo.findById(id);
    if (task && ENGINE_TYPES.has(task.type) && this.engine) {
      this.repo.updateStatus([id], "stopped");
      void this.engine.pause(id).catch((err) =>
        logger.warn(`engine pause failed id=${id}: ${err?.message ?? err}`),
      );
      return;
    }
    this.queue.stop(String(id));
  }

  /** 回写去重：任务 id → 上一次解析出的落盘路径（FILE: 行每秒一条，跳过重复解析） */
  private readonly btLastPath = new Map<string, string>();

  /**
   * BT 任务下载输出流 → 回写实际种子名（server.ts 的 onMessage 逐行调用）。
   * 磁力任务创建时只有 untitled/dn 占位名；aria2c 拿到 metadata 后每秒打印
   * `FILE: <落盘路径>`，据此把 DB name 换成种子真实名 —— 列表/文件检查
   * （checkFileExists）/播放匹配（/api/v1/videos title）才能按种子名命中。
   * 幂等：解析结果与上次相同或与现名一致直接跳过；撞名按既有规则加随机后缀。
   */
  noteBtResult(id: string, line: string, localPath: string): void {
    if (localPath === "") return;
    const file = aria2BtPathFromLine(line);
    if (file === "") return;
    if (this.btLastPath.get(id) === file) return;
    this.btLastPath.set(id, file);

    const dbID = Number.parseInt(id, 10);
    if (Number.isNaN(dbID)) return; // 内存任务（非 DB，无记录可回写）
    const task = this.repo.findById(dbID);
    if (!task || task.type !== "bt") return; // direct 同走 aria2c，但 name 是用户指定的，不回写

    let searchDir = taskTmpDir(id, task.folder, localPath);
    let name = btNameFromPath(file, searchDir);
    if (name === "" || name === task.name) return;
    const existing = this.repo.findByName(name);
    if (existing && existing.id !== dbID) name = `${name}-${randomName()}`;
    try {
      this.repo.update(dbID, { name });
      logger.info(`bt task ${dbID} renamed to "${name}" (from ${file})`);
    } catch (err: any) {
      logger.warn(`bt task ${dbID} rename failed: ${err?.message ?? err}`);
    }
  }

  /** 任务终态（success/failed/stopped）后释放回写去重记录 */
  forgetBtTask(id: string): void {
    this.btLastPath.delete(id);
  }

  /**
   * 下载成功后落盘收敛（onSuccess 调用）：下载器把产物写在任务临时目录
   * .meipart-<id>/ 内保护已存在文件 —— 这里把产物 rename 到任务目录的最终名，
   * 并清掉临时目录的零碎残余。rename 同分区原子；目标已存在时按「重新下载
   * 覆盖」语义先移除再 rename（目录情形 rename 会因非空失败）。
   */
  finalizeTask(id: string, localPath: string): void {
    if (localPath === "") return;
    const dbID = Number.parseInt(id, 10);
    const task = Number.isNaN(dbID) ? null : this.repo.findById(dbID);
    const folder = task?.folder ?? null;
    const tmpDir = taskTmpDir(id, folder, localPath);
    const targetDir = resolveTaskDir(folder, localPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    } catch {
      return; // 临时目录不存在（无产物可收敛）：交给既有落盘链路兜底
    }
    // 产物识别：优先目录（bt 多文件种子）；否则取最大的非控制文件
    // （.aria2 续传控制、分片点文件都不算产物）
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );
    const files = entries
      .filter(
        (e) =>
          e.isFile() && !e.name.startsWith(".") && !e.name.endsWith(".aria2"),
      )
      .map((e) => ({
        name: e.name,
        size: fs.statSync(path.join(tmpDir, e.name)).size,
      }))
      .sort((a, b) => b.size - a.size);
    const pick = dirs[0]?.name ?? files[0]?.name;
    if (!pick) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const src = path.join(tmpDir, pick);
      const dst = path.join(targetDir, pick);
      if (fs.existsSync(dst)) {
        // 覆盖语义：删旧再移入（不 rename 直覆目录，避免 ENOTEMPTY）
        fs.rmSync(dst, { recursive: true, force: true });
      }
      fs.renameSync(src, dst);
      logger.info(`task ${id} finalized: ${pick} → ${targetDir}`);
    } catch (err: any) {
      logger.warn(`task ${id} finalize failed: ${err?.message ?? err}`);
      return; // rename 失败保留临时目录，产物不丢
    }
    // 清理临时目录残余（分片/控制文件；rename 失败路径上方已 return）
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  /**
   * 删除下载任务：
   * - 总是先停队列/暂停引擎（删记录后不允许下载继续进行/文件再落盘）
   * - deleteFiles=true 时尽力清理落盘产物；文件由引擎管理时引擎删除比本地
   *   按名猜测删除更准（含引擎临时/分段文件）
   * - localPath 由调用方（handlers）从运行时配置取，服务层不持有 conf
   */
  deleteDownloadTask(
    id: number,
    opts?: { deleteFiles?: boolean; localPath?: string },
  ): void {
    const task = this.repo.findById(id);
    if (!task) return;
    const isEngineTask = ENGINE_TYPES.has(task.type);
    // 队列任务：queue.stop 只对活动任务有效（非活动抛 ErrTaskNotFound 静默）；
    // 引擎任务：暂停引擎任务（引擎删除前先停，避免删除瞬间的继续写入）
    if (isEngineTask && this.engine) {
      void this.engine.pause(id).catch(() => {});
    } else {
      try {
        this.queue.stop(String(id));
      } catch {
        // 非活动任务无需停止
      }
    }
    // 半成品临时目录（.meipart-<id>，队列/aria2 时代产物）：删除任务时总是清理
    // （deleteFiles=false 用户只是不想删成品文件，不代表保留半成品）
    {
      const localPathForTmp = opts?.localPath || "";
      if (localPathForTmp !== "") {
        try {
          fs.rmSync(taskTmpDir(String(id), task.folder, localPathForTmp), {
            recursive: true,
            force: true,
          });
        } catch {
          // 临时目录不存在：无事
        }
      }
    }
    // 引擎任务：引擎删除是权威清理（含半成品/分段/做种句柄），deleteFiles
    // 控制是否连成品一起删；engineTaskId 在 repo.delete 前捕获（防竞态）。
    // 引擎对成品文件的删除按其 DB fileName 定位——撞名改名/历史数据可能
    // 让引擎 fileName 与 DB 行名错位而漏删，故删后按引擎字段兜底再扫一遍
    if (isEngineTask && this.engine && task.engineTaskId) {
      const engineTaskId = task.engineTaskId;
      const deleteFiles = opts?.deleteFiles === true;
      const localPathForEngine = opts?.localPath || "";
      void this.engineDeleteCascade(
        id,
        engineTaskId,
        deleteFiles,
        localPathForEngine,
        task,
      );
    }
    if (opts?.deleteFiles) {
      const localPath = opts.localPath || "";
      if (localPath !== "") {
        try {
          // 目录解析唯一规则（内置 key → 下载根/key；其余 localDir+folder）
          const dir = resolveTaskDir(task.folder, localPath);
          // 成品文件（name.<ext>）与下载器输出目录（name/）都算落盘产物
          const [, file] = checkFileExists(task.name, dir);
          if (file !== "") fs.rmSync(file, { recursive: true, force: true });
        } catch (err: any) {
          logger.warn(`删除任务 ${id} 落盘文件失败: ${err?.message ?? err}`);
        }
      }
    }
    this.repo.delete(id);
  }

  /**
   * 引擎任务删除级联：先取引擎权威字段（saveDir/fileName）→ 引擎删除
   * （权威清理）→ deleteFiles 时按引擎字段兜底扫成品（引擎 fileName 与
   * DB 行名错位时引擎侧会漏删）。只扫「引擎 saveDir 与本行任务目录一致」
   * 的产物路径（引擎控制台自定目录的任务只依赖引擎自身删除）；其它行
   * 占用同名产物时跳过（不带走别人的文件）。
   */
  private async engineDeleteCascade(
    dbId: number,
    engineTaskId: string,
    deleteFiles: boolean,
    localPath: string,
    task: Video,
  ): Promise<void> {
    const info = await this.engine!.taskInfo(dbId).catch(() => null);
    await this.engine!.delete(engineTaskId, deleteFiles).catch((err) =>
      logger.warn(`engine task ${dbId} cleanup failed: ${err?.message ?? err}`),
    );
    if (!deleteFiles || !info || localPath === "") return;
    const expectedDir = resolveTaskDir(task.folder, localPath);
    if (info.saveDir !== expectedDir || info.fileName === "") return;
    const product = path.join(info.saveDir, info.fileName);
    // 同名守卫：其它行登记同名（种子内文件撞名/历史重复）时不删
    const base = path.basename(product);
    const other = this.repo.findByName(base);
    if (other && other.id !== dbId && other.type === task.type) return;
    try {
      fs.rmSync(product, { recursive: true, force: true });
    } catch (err: any) {
      logger.warn(
        `engine task ${dbId} product sweep failed: ${err?.message ?? err}`,
      );
    }
  }

  async getDownloadLog(id: number): Promise<string> {
    if (!this.logs) return "";
    try {
      return await this.logs.read(String(id));
    } catch {
      throw new Error("log not found");
    }
  }

  getTaskFolders(): string[] {
    return this.repo.findDistinctFolders();
  }

  exportDownloadList(): string {
    const tasks = this.repo.findAll("DESC");
    return tasks.map((t) => `${t.url} ${t.name}`).join("\n");
  }

  setStatus(ids: number[], status: string): void {
    this.repo.updateStatus(ids, status);
  }

  setIsLive(id: number, isLive: boolean): Video {
    return this.repo.updateIsLive(id, isLive);
  }

  findActiveTasks(): Video[] {
    return this.repo.findByStatus(["pending", "downloading"]);
  }

  findByIdOrFail(id: number): Video {
    return this.repo.findByIdOrFail(id);
  }
}
