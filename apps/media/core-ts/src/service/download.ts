// service/download —— Go internal/service/download_task.go 的复刻

import fs from "node:fs";
import path from "node:path";
import { extractTorrentMeta } from "../core/bencode.ts";
import {
  resolveTaskDir,
  sanitizeFilename,
  sanitizeFolder,
} from "../core/downloader.ts";
import { logger } from "../logger.ts";
import type { TaskQueue } from "../core/queue.ts";
import type { DownloadParams } from "../core/types.ts";
import type { TaskLogManager } from "../tasklog.ts";
import type { Video, VideoRepository } from "../db.ts";
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
}

export interface DownloadTaskWithFile extends Video {
  exists: boolean;
  file?: string;
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

  constructor(
    repo: VideoRepository,
    queue: TaskQueue,
    logs: TaskLogManager | null,
  ) {
    this.repo = repo;
    this.queue = queue;
    this.logs = logs;
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
      return withFile;
    });
    return { total: result.total, list };
  }

  /** 启动下载：状态置 pending → 入队（入队结果回写状态） */
  async startDownload(
    taskID: number,
    _localPath: string,
    _deleteSegments: boolean,
  ): Promise<void> {
    const video = this.repo.findByIdOrFail(taskID);
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
      // BT 种子文件任务的内容勾选（--select-file）
      selectFile: video.selectFile ?? "",
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

  stopDownload(id: number): void {
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

    let searchDir = localPath;
    if (task.folder && task.folder !== "")
      searchDir = resolveTaskDir(task.folder, localPath);
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
   * 删除下载任务：
   * - 总是先停队列（删记录后不允许下载继续进行/文件再落盘）
   * - deleteFiles=true 时尽力清理落盘产物（成功任务的媒体文件/下载器输出目录，
   *   以及未完成任务的分片临时目录），文件缺失不阻断记录删除
   * - localPath 由调用方（handlers）从运行时配置取，服务层不持有 conf
   */
  deleteDownloadTask(
    id: number,
    opts?: { deleteFiles?: boolean; localPath?: string },
  ): void {
    const task = this.repo.findById(id);
    // queue.stop 只对活动任务有效，非活动（已完成/排队中/不存在）抛 ErrTaskNotFound：
    // 删除记录时静默忽略（排队中的任务由 repo.delete 消失，队列补位时按 404 跳过）
    try {
      this.queue.stop(String(id));
    } catch {
      // 非活动任务无需停止
    }
    if (task && opts?.deleteFiles) {
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
