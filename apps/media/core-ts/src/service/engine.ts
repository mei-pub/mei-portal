// service/engine —— FluxDown 引擎桥接层（下载中心统一执行引擎的门户）
//
// 职责：引擎任务的创建与 DB 关联（engineTaskId）、磁力解析会话（引擎内
// 挂起等用户选文件，对齐 FluxDown 官方交互模型）、事件驱动的镜像同步
//（引擎为唯一事实源，DB/队列视图/SSE 全部由 taskChanged/taskProgress
// 事件派生）、任务操作集（暂停/恢复/删除/改名/换源）与断线重连后的
// 全量对账。
//
// 引擎侧语义（v0.5.4 实测）：
// - 磁力任务创建即解析 metadata（status=5 preparing）；文件清单就绪后发
//   selectionPending（60s deadline，无应答默认全部文件）；应答后按
//   only_files 下载
// - 完成后按 bt_seed 配置做种（seedingStatus 上报）；fileExists 冲突默认
//   rename（"name (1)"）
// - 任务事件：taskChanged（状态/名称/字节）、taskProgress（实时速度/做种）、
//   taskDeleted；断线重连后经 snapshot 全量对账

import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.ts";
import type { Hub } from "../api/sse.ts";
import type { TaskQueue } from "../core/queue.ts";
import type { TaskInfo } from "../core/types.ts";
import type { TaskLogManager } from "../tasklog.ts";
import type { Video, VideoRepository } from "../db.ts";
import {
  FD_SEEDING_STATUS,
  FD_TASK_STATUS,
  FluxDownClient,
  FluxDownUnavailableError,
  type FdBtFile,
  type FdConfigSnapshot,
  type FdDaemonEvent,
  type FdTask,
  type FdTaskProgress,
} from "../core/fluxdown.ts";
import { extractTorrentMeta, torrentInfoHash } from "../core/bencode.ts";

/** 走引擎执行的 DB 任务类型（其余 m3u8/bilibili/youtube/mediago 仍走队列+外部工具） */
export const ENGINE_TYPES = new Set(["direct", "bt"]);

/** 磁力/种子 BT 解析结果（resolve-magnet 响应 + 表单预填契约） */
export interface BtPreview {
  hash: string;
  name: string;
  size: number;
  /** 1-based 索引（与 UI 勾选/既有契约一致；引擎侧 0-based，提交时换算） */
  files: Array<{ index: number; path: string; size: number }> | null;
  /** 已在本下载中心存在（未完成续传 / 历史记录） */
  existed: boolean;
  /** 已存在且下载完成（UI 提示取消 / 重新下载） */
  completed: boolean;
  /** 解析会话绑定的引擎任务（gateway 纯缓存解析时为空；提交时免重建） */
  engineTaskId?: string;
  /** 目录锁定：existed 任务的提交按 url+saveDir 匹配接管，目录必须沿用。
   *  folderLocked=true 时 folder = 必须沿用的目录 key（空串 = 下载根） */
  folderLocked?: boolean;
  folder?: string;
  /** existed 任务的 DB 行 id（UI「删旧重下」二次确认后删除该行） */
  existedId?: number;
}

/** 解析/任务会话状态 */
interface EngineSession {
  engineTaskId: string;
  hash: string;
  /** 磁力原文（会话过期重建用；种子文件会话为空） */
  magnet?: string;
  saveDir: string;
  /** resolve = 解析会话（表单未提交，选择请求挂起）；task = 已提交任务 */
  kind: "resolve" | "task";
  dbId?: number;
  /** 提交时携带的文件选择（"1,3-5" 1-based 原文；selectionPending 到达时换算） */
  selectFile?: string;
  /** 引擎侧挂起的选择请求 ID（selectionPending 事件暂存） */
  pendingRequestId?: string;
  /** selectionPending 已到但用户尚未应答（resolve 会话） */
  files?: FdBtFile[];
  /** 选择超时（默认全量已触发）——提交时需重建 */
  expired?: boolean;
  /** resolve 会话的元数据等待（resolve-magnet 长轮询） */
  waiter?: {
    resolve: (files: FdBtFile[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
}

/** 引擎实时数据（/api/tasks 附加字段；UI 任务列表/详情消费） */
export interface EngineRuntimeInfo {
  taskId: string;
  status: number;
  percent: number;
  speed: string;
  uploadSpeed: string;
  uploadedBytes: number;
  downloadedBytes: number;
  totalBytes: number;
  seeding: number;
  seedingMessage: string;
  seedingTimeSecs: number;
  /** 已连接 peer 数（BT） */
  peers?: number | null;
  /** 活跃传输数（分段/连接） */
  activeTransfers?: number | null;
}

// ---- 工具 ----

/** bytes/s → "1.5MiB/s"（对齐 aria2 速度串的展示形态） */
export function fmtSpeedBps(bps: number): string {
  if (bps <= 0) return "0B/s";
  const units = ["B", "KiB", "MiB", "GiB"];
  let v = bps;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${units[u]}/s`;
}

/** 磁力 → 小写 btih；种子文件路径 → infohash；解析失败返回空串 */
export function btHashOf(url: string): string {
  const m = /urn:btih:([0-9a-fA-F]{40})/.exec(url);
  if (m) return m[1]!.toLowerCase();
  if (/\.torrent$/i.test(url)) {
    try {
      return torrentInfoHash(fs.readFileSync(url)) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

/** "K: V" 多行文本 → Record（表单 additionalHeaders → 引擎 headers） */
export function parseHeaderLines(text: string | null | undefined): Record<string, string> | undefined {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k !== "" && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** "1,3-5"（1-based）→ 0-based 引擎索引数组；空 = 全部（undefined） */
function selectFileToIndices(sel: string | null | undefined, fileCount: number): number[] | undefined {
  if (typeof sel !== "string" || sel.trim() === "") return undefined;
  const picked = new Set<number>();
  for (const part of sel.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    for (let i = lo; i <= hi && i - lo < 1000; i++) {
      if (i >= 1 && i <= fileCount) picked.add(i - 1);
    }
  }
  if (picked.size === 0 || picked.size >= fileCount) return undefined; // 全选
  return [...picked].sort((a, b) => a - b);
}

/** 引擎任务状态 → 下载中心任务状态 */
function mapStatus(st: number): "pending" | "downloading" | "stopped" | "success" | "failed" {
  switch (st) {
    case FD_TASK_STATUS.pending:
      return "pending";
    case FD_TASK_STATUS.paused:
      return "stopped";
    case FD_TASK_STATUS.completed:
      return "success";
    case FD_TASK_STATUS.error:
      return "failed";
    default:
      // downloading / preparing：准备中视作下载中（0%），与既有 UI 兼容
      return "downloading";
  }
}

export interface EngineBridgeOptions {
  localDir(): string;
  configDir(): string;
  /** 任务目录解析（内置 key bt/files/video → 下载根下子目录；相对段 → localDir+folder） */
  resolveTaskDir(folder: string | null | undefined, localDir?: string): string;
  /** 文件名清洗（与 DB 任务名/落盘名一致） */
  sanitizeFilename(name: string): string;
  /** 撞名随机后缀 */
  randomName(): string;
}

export class EngineBridge {
  private readonly fd: FluxDownClient;
  private readonly repo: VideoRepository;
  private readonly queue: TaskQueue;
  private readonly hub: Hub;
  private readonly logs: TaskLogManager | null;
  private readonly opts: EngineBridgeOptions;
  /** engineTaskId → 会话 */
  private sessions = new Map<string, EngineSession>();
  /** btih → 会话（磁力重复解析/提交定位） */
  private sessionsByHash = new Map<string, EngineSession>();
  /** dbId → 引擎实时数据（/api/tasks 附加） */
  private runtimeByDbId = new Map<number, EngineRuntimeInfo>();
  /** dbId → 上报过的状态（跨事件变更检测） */
  private lastStatusByDbId = new Map<number, string>();
  /** dbId → 已镜像过的引擎 fileName——同一 fileName 只触发改名一次。
   *  没有该守卫时：去重后缀让 row.name 永远 ≠ fileName，镜像轮询每轮
   *  重新改名（findByName 再撞既有行 → 新随机后缀 → 无限循环改名） */
  private lastMirroredNameByDbId = new Map<number, string>();
  /** 占位任务 → 引擎既有同种子任务（duplicateTorrent 事件暂存，create 后核验消费） */
  private duplicateOf = new Map<string, string>();
  /** engineTaskId → 早到的选择请求（selectionPending 早于 link()/解析会话注册到达时
   *  缓冲，注册后回放；非桥接任务不登记，引擎 60s 默认应答兜底） */
  private pendingSelections = new Map<
    string,
    { req: import("../core/fluxdown.ts").FdSelectionRequest; at: number }
  >();
  /** 引擎任务实时扩展（taskRuntimeChanged：节点数/活跃传输） */
  private peersByEngineTask = new Map<string, { peers: number | null; activeTransfers: number | null }>();
  /** 引擎任务 → 最新分段进度（segmentProgress 事件；详情抽屉分段可视化） */
  private segmentsByTask = new Map<
    string,
    {
      totalBytes: number;
      segmentCount: number;
      segments: Array<{ index: number; startByte: number; endByte: number; downloadedBytes: number }>;
      at: number;
    }
  >();
  /** dbId → 速度历史采样（{t, bps, upBps}，尾新；详情抽屉速度曲线） */
  private speedHistoryByDbId = new Map<number, Array<{ t: number; bps: number; upBps: number }>>();
  private lastSampleAtByDbId = new Map<number, number>();
  /** 引擎全局运行统计（runtimeStatsChanged 事件缓存；活跃/速度/磁盘） */
  private runtimeStats: import("../core/fluxdown.ts").FdRuntimeStats | null = null;
  private ready = false;

  constructor(
    fd: FluxDownClient,
    repo: VideoRepository,
    queue: TaskQueue,
    hub: Hub,
    logs: TaskLogManager | null,
    opts: EngineBridgeOptions,
  ) {
    this.fd = fd;
    this.repo = repo;
    this.queue = queue;
    this.hub = hub;
    this.logs = logs;
    this.opts = opts;
  }

  /** 装配（server.ts 启动时调用）：事件订阅 + 状态联动 */
  start(): void {
    this.fd.onDaemonEvent((e) => this.onEvent(e));
    this.fd.onStateChange((ready) => {
      this.ready = ready;
      if (ready) void this.reconcile().catch((err) =>
        logger.warn(`engine reconcile failed: ${err?.message ?? err}`));
    });
    this.fd.start();
  }

  isReady(): boolean {
    return this.ready;
  }

  /** 引擎版本（设置页状态卡；不要求 WS 就绪——REST /ping 探活） */
  async fdVersion(): Promise<string> {
    const r = await this.fd.restPing(5000);
    return r.version;
  }

  /** 等引擎就绪（resolve/submit 前调用；超时抛 unavailable） */
  async waitReady(timeoutMs = 30000): Promise<void> {
    if (this.ready) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new FluxDownUnavailableError());
      }, timeoutMs);
      const off = this.fd.onStateChange((ready) => {
        if (ready) {
          cleanup();
          resolve();
        }
      });
      const cleanup = () => {
        clearTimeout(timer);
        off();
      };
    });
  }

  // ---- 磁力解析（表单预览契约保持：resolve-magnet 长轮询）----

  private torrentsCacheDir(): string {
    return path.join(this.opts.configDir(), "torrents");
  }

  /** 索引网关拉档（itorrents.org 按 infohash 直取存档；校验防污染档） */
  private async gatewayTorrent(hash: string): Promise<Buffer | null> {
    const url = `https://itorrents.org/torrent/${hash.toUpperCase()}.torrent`;
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 20_000_000) return null;
    if (torrentInfoHash(buf) !== hash) {
      logger.warn(`index gateway infohash mismatch for ${hash}, ignoring`);
      return null;
    }
    try {
      fs.mkdirSync(this.torrentsCacheDir(), { recursive: true });
      fs.writeFileSync(path.join(this.torrentsCacheDir(), `${hash}.torrent`), buf);
    } catch (err: any) {
      logger.warn(`torrent cache write failed: ${err?.message ?? err}`);
    }
    return buf;
  }

  private cachedTorrent(hash: string): Buffer | null {
    try {
      return fs.readFileSync(path.join(this.torrentsCacheDir(), `${hash}.torrent`));
    } catch {
      return null;
    }
  }

  /** 本下载中心既有任务查重（按 btih 归一匹配 DB 任务） */
  private findExistingByHash(hash: string): Video | null {
    try {
      const all = this.repo.findByStatus([
        "pending",
        "downloading",
        "stopped",
        "failed",
        "success",
      ]);
      return (
        all.find(
          (v) =>
            v.type === "bt" &&
            btHashOf(v.url) === hash &&
            // 提交失败且无引擎关联的死行不构成「已存在」——再解析应全新
            //（提交失败常见于重复磁力报错，行只是失败历史，无接管对象）
            !(v.status === "failed" && !v.engineTaskId),
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * 磁力内容解析（对齐既有 resolve-magnet 契约；引擎会话挂起等用户选文件）：
   * 1. 同 hash 解析会话复用（表单防抖/重复点击不重复建任务）
   * 2. 既有任务查重（DB 活动任务 / 引擎同 url 任务 → existed，不重复建）
   * 3. itorrents 网关快路径：有档则种子直供引擎（metadata 秒出）
   * 4. 引擎建任务（磁力原文或种子）→ 建后核验（引擎对同 infohash 去重会
   *    静默移除 placeholder——移除即视为已存在，转 existed 语义）
   * 5. 等待 selectionPending 带出文件清单（60s 选择期限由引擎侧控制；
   *    解析等待上限 100s）
   * 会话保持挂起：提交时经 submitBt 应答选择；取消经 discardResolve。
   */
  async resolveMagnet(magnet: string, folder: string | null): Promise<BtPreview> {
    await this.waitReady();
    const hash = btHashOf(magnet);
    if (hash === "") throw new Error("invalid magnet link (btih required)");

    // 1. 同 hash 解析会话复用：返回会话既有的文件清单（若已到）或共享等待
    const prior = this.sessionsByHash.get(hash);
    if (prior && prior.kind === "resolve" && !prior.expired) {
      if (prior.files && prior.files.length > 0) {
        return this.previewFromSession(prior, magnet, false);
      }
      // 会话尚未出清单（metadata 解析中）：与首个请求共享等待（不重复建任务）
      const files = await new Promise<FdBtFile[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("磁力解析超时（无人做种或网络受限），请稍后重试")),
          90_000,
        );
        const poll = setInterval(() => {
          if (prior.files && prior.files.length > 0) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve(prior.files);
          }
        }, 500);
        setTimeout(() => {
          clearInterval(poll);
        }, 90_000);
      });
      return this.previewFromSession(prior, magnet, false);
    }

    const existing = this.findExistingByHash(hash);
    const saveDir = this.opts.resolveTaskDir(folder, this.opts.localDir());

    // 2a. 已有活动 DB 任务（pending/downloading）：引擎侧种子在跑——文件清单
    // 无法从 TaskDto 取（只有选择请求带文件），files=null 由 UI 走「已存在」
    if (
      existing &&
      (existing.status === "pending" || existing.status === "downloading")
    ) {
      const linked = existing.engineTaskId
        ? await this.fd
            .call<FdTask>("daemon.task.get", { taskId: existing.engineTaskId })
            .catch(() => null)
        : null;
      return {
        hash,
        name: existing.name,
        size: linked?.totalBytes ?? 0,
        files: null,
        existed: true,
        completed: false,
        // 既有活动任务：提交走 url+saveDir 匹配接管，目录必须沿用
        folder: existing.folder ?? "",
        folderLocked: true,
        existedId: existing.id,
      };
    }
    // 2b. 引擎里已有同 url 任务（本桥接历史提交 / 控制台手加）：不重复建
    const list = await this.fd
      .call<FdTask[]>("daemon.task.list")
      .catch(() => [] as FdTask[]);
    const dupByUrl = list.find(
      (t) => t.url === magnet && t.status !== FD_TASK_STATUS.error,
    );
    if (dupByUrl) {
      return {
        hash,
        name: dupByUrl.fileName || magnetDisplayNameOf(magnet) || "untitled",
        size: dupByUrl.totalBytes,
        files: null,
        existed: true,
        completed: dupByUrl.status === FD_TASK_STATUS.completed,
        folder: this.folderKeyOf(dupByUrl.saveDir) ?? "",
        folderLocked: true,
        existedId: this.repo.findByEngineTaskId(dupByUrl.taskId)?.id,
      };
    }

    // 3. 网关快路径（缓存 → 直取；均失败则磁力原文走 DHT）
    let torrentB64: string | null = null;
    const cached = this.cachedTorrent(hash);
    if (cached) {
      torrentB64 = cached.toString("base64");
    } else {
      const buf = await this.gatewayTorrent(hash);
      if (buf) torrentB64 = buf.toString("base64");
    }

    // 4. 引擎建任务（挂起的选择请求 = 解析会话）。
    //    会话在 create 返回后立即注册——selectionPending 事件可能在核验
    //    完成前到达（元数据即时），晚注册会丢事件。
    const created = (await this.fd.call<{ taskId: string }>("daemon.task.create", {
      request: {
        url: torrentB64 ? "" : magnet,
        saveDir,
        torrentB64: torrentB64 ?? undefined,
      },
    })) as { taskId: string };
    const engineTaskId = created.taskId;
    const session: EngineSession = {
      engineTaskId,
      hash,
      magnet,
      saveDir,
      kind: "resolve",
    };
    this.sessions.set(engineTaskId, session);
    this.sessionsByHash.set(hash, session);
    // 回放早到的选择请求（事件可能在 create 响应往返期间先行到达）
    this.replayPendingSelection(session);

    // 4b. 建后核验（共享 helper）：引擎对同 infohash 去重会发 duplicateTorrent
    // 事件（携带 existingTaskId）并移除占位任务。元数据/选择已到
    //（session.files 非空）即视为成功短路。
    {
      const dup = await this.postCreateVerify(
        engineTaskId,
        () => session.files !== undefined,
      );
      if (dup !== null) {
        this.dropSession(session);
        const survivor =
          dup !== ""
            ? await this.fd
                .call<FdTask>("daemon.task.get", { taskId: dup })
                .catch(() => null)
            : null;
        if (survivor) {
          // 既有任务无 DB 关联 → 收养（孤儿：引擎控制台/历史残留）
          this.adoptEngineTask(survivor);
          return {
            hash,
            name: survivor.fileName || magnetDisplayNameOf(magnet) || "untitled",
            size: survivor.totalBytes,
            files: null,
            existed: true,
            completed: survivor.status === FD_TASK_STATUS.completed,
            folder: this.folderKeyOf(survivor.saveDir) ?? "",
            folderLocked: true,
            existedId: this.repo.findByEngineTaskId(survivor.taskId)?.id,
          };
        }
        throw new Error(
          "该种子已在下载引擎中存在（由其他方式添加），请在任务列表中查看或稍后重试",
        );
      }
    }

    // 5. 等文件清单（selectionPending 事件唤醒）
    const files = await new Promise<FdBtFile[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.waiter = undefined;
        // 超时：**保留**会话与引擎任务——引擎侧按自己的 300s 死线继续解析
        // （冷 DHT 下元数据常需数分钟），重试解析共享等待续等；取消走
        // discard-magnet；引擎 300s 失败后 taskDeleted 事件自清，无孤儿。
        // 旧实现超时即弃置会话，把 DHT 预热与解析进度一并扔掉（实测
        // Sintel 磁力冷 DHT 需 ~5 分钟，100s 超时即弃 = 永远解析不出）
        reject(new Error("磁力解析超时（无人做种或网络受限），请稍后重试"));
      }, 100_000);
      session.waiter = { resolve, reject, timer };
      if (session.files) {
        // 事件先到：立即返回
        const f = session.files;
        session.waiter = undefined;
        clearTimeout(timer);
        resolve(f);
      }
    });

    // 无人接管的解析会话防抢跑：55s（早于引擎 60s 对话框默认「全量下载」）
    // 自动应答取消。headless 部署里被遗弃的磁力不应静默全量下载占带宽；
    // 用户稍后提交时 discardSession + 重建（种子已缓存，秒级）
    if (session.pendingRequestId) {
      const rid = session.pendingRequestId;
      setTimeout(() => {
        if (session.kind !== "resolve" || session.pendingRequestId !== rid) {
          return; // 已被提交接管 / 已应答
        }
        session.expired = true;
        session.pendingRequestId = undefined;
        void this.fd
          .call("daemon.selection.resolve", {
            requestId: rid,
            outcome: { kind: "bt", indices: [-1] },
          })
          .catch(() => {});
      }, 55_000);
    }
    return this.previewFromSession(session, magnet, existing !== null);
  }

  /** 解析会话 → 预览结果（文件清单 + 引擎侧任务名/大小） */
  private async previewFromSession(
    session: EngineSession,
    magnet: string,
    existed: boolean,
  ): Promise<BtPreview> {
    const files = session.files ?? [];
    const task = await this.fd
      .call<FdTask>("daemon.task.get", { taskId: session.engineTaskId })
      .catch(() => null);
    if (!task) {
      // 会话的引擎任务已消失：torrentB64 去重竞态逃逸（占位被引擎移除）。
      // 丢弃会话并按「已存在」报错——返回死任务 id 会让提交挂到空关联上
      this.dropSession(session);
      throw new Error(
        "该种子已在下载引擎中存在，请在任务列表中查看或稍后重试",
      );
    }
    // fileName 在 metadata 回填前为空串：|| 兜底（dn → 文件路径首段）
    const fromFiles =
      files.length > 0 ? (files[0]!.path.split(/[\\/]/)[0] ?? "").replace(/\.[^.]+$/, "") : "";
    const name =
      task?.fileName ||
      magnetDisplayNameOf(magnet) ||
      (fromFiles !== "" ? fromFiles : "untitled");
    const size = files.reduce((s, f) => s + Math.max(0, f.size), 0);
    return {
      hash: session.hash,
      name,
      size,
      files: files.map((f) => ({ index: f.index + 1, path: f.path, size: f.size })),
      existed,
      completed: false,
      engineTaskId: session.engineTaskId,
      // 新解析会话：目录不锁（提交时按表单目录接管/重建均可；
      // existed 时提交走 url+saveDir 匹配接管，目录已被上游分支锁定）
      folderLocked: existed,
    };
  }

  /** 引擎任务 saveDir → 表单 folder key（resolveTaskDir 的逆映射：内置键
   *  挂下载根，自定义目录挂 localDir；根外返回 null） */
  private folderKeyOf(saveDir: string): string | null {
    const root = this.downloadRoot();
    if (root !== "" && saveDir.startsWith(root + "/")) {
      return saveDir.slice(root.length + 1) || "";
    }
    const base = this.opts.localDir();
    if (saveDir === base) return "";
    if (saveDir.startsWith(base + "/")) return saveDir.slice(base.length + 1);
    return null;
  }

  /** 弃置解析会话（表单取消/关闭）：删引擎任务 + 清会话 */  async discardResolve(hash: string): Promise<void> {
    const session = this.sessionsByHash.get(hash);
    if (session) {
      await this.discardSession(session);
      return;
    }
    // 会话可能已超时自清：幂等成功
  }

  private async discardSession(session: EngineSession): Promise<void> {
    this.dropSession(session);
    try {
      await this.fd.call("daemon.task.delete", {
        taskId: session.engineTaskId,
        // 过期会话已按「全部文件」开始下载——连已落盘的半成品一起清；
        // 挂起中的会话尚无产物，两种取值语义等价
        deleteFiles: session.expired === true,
      });
    } catch (err: any) {
      logger.warn(
        `engine session cleanup failed (${session.hash}): ${err?.message ?? err}`,
      );
    }
  }

  private dropSession(session: EngineSession): void {
    if (session.waiter) {
      clearTimeout(session.waiter.timer);
      session.waiter.reject(new Error("magnet resolve cancelled"));
      session.waiter = undefined;
    }
    session.pendingRequestId = undefined; // 防遗弃取消定时器误答已删除的请求
    this.sessions.delete(session.engineTaskId);
    if (this.sessionsByHash.get(session.hash) === session) {
      this.sessionsByHash.delete(session.hash);
    }
  }

  // ---- 任务提交（downloadCreate → startDownload 引擎类型分支）----

  /**
   * BT 任务提交。两条路径：
   * - 全选（无 selectFile）：接管解析会话，立即应答「全部」（[]）——
   *   全选路径引擎不进 update_only_files 等待，安全
   * - 子集选择：**不用**解析会话应答（会话存续期间引擎已把种子 pause，
   *   子集应答会让引擎在 paused 句柄上等 update_only_files —— 0.5.4
   *   实测死锁：单线程 actor 冻结、任务永久停在 preparing、事件管道死亡）。
   *   改为：弃置会话 → 以缓存种子（或磁力原文）重建任务 → 文件选择由
   *   selectionPending 事件到达时的 autoAnswer 抢答（该事件在 add 后立即
   *   发出、早于后台 pause 生效——apply_only_files 的 init 等待在非
   *   paused 句柄上正常完成）。上游修复该死锁后可回归直答路径。
   */
  async submitBt(
    dbId: number,
    url: string,
    name: string,
    folder: string | null,
    selectFile: string | null,
    queueId: string | null = null,
  ): Promise<string> {
    await this.waitReady();
    const saveDir = this.opts.resolveTaskDir(folder, this.opts.localDir());
    const hash = btHashOf(url);
    const session = hash !== "" ? this.sessionsByHash.get(hash) : undefined;
    const hasSubset =
      typeof selectFile === "string" && selectFile.trim() !== "";

    if (
      session &&
      !session.expired &&
      session.saveDir === saveDir &&
      !hasSubset
    ) {
      // 全选接管：登记 DB 关联 + 应答「全部」（空数组 = 全部，立即确定性生效）
      session.kind = "task";
      session.dbId = dbId;
      session.selectFile = undefined;
      this.repo.update(dbId, { engineTaskId: session.engineTaskId });
      if (session.pendingRequestId) {
        await this.fd
          .call("daemon.selection.resolve", {
            requestId: session.pendingRequestId,
            outcome: { kind: "bt", indices: [] },
          })
          .catch((err: any) =>
            logger.warn(`bt selection resolve (all) failed: ${err?.message ?? err}`));
      }
      await this.pushName(session.engineTaskId, name);
      return session.engineTaskId;
    }

    // 重建路径：解析会话（子集选择）/过期/目录变更 → 先弃置
    if (session) await this.discardSession(session);

    let torrentB64: string | null = null;
    let magnet = "";
    if (/\.torrent$/i.test(url)) {
      torrentB64 = fs.readFileSync(url).toString("base64"); // 白名单已校验（torrents 目录内）
    } else if (/^magnet:/i.test(url)) {
      magnet = url;
      // 引擎里已有同磁力任务（历史提交 / 残留）：幂等接管，避免同一
      // infohash 双任务（做种冲突 + 落盘撞名）。子集接管的前提是引擎 DB
      // 已持久化过该任务的选择（重启恢复走 AtAdd 预烘焙，安全）
      const list = await this.fd
        .call<FdTask[]>("daemon.task.list")
        .catch(() => [] as FdTask[]);
      const dup = list.find(
        (t) => t.url === magnet && t.saveDir === saveDir,
      );
      if (dup) {
        this.link(dbId, dup.taskId, hash, saveDir, magnet, selectFile);
        // 接管时尊重所选队列（既有任务已在别的队列时挪入）
        if (queueId && dup.queueId !== queueId) {
          await this.fd
            .call("daemon.queue.moveTask", { queueId, taskId: dup.taskId })
            .catch((err: any) =>
              logger.warn(
                `queue move on bt takeover failed: ${err?.message ?? err}`,
              ));
        }
        logger.info(
          `engine bt task takeover (existing ${dup.taskId.slice(0, 8)} for db ${dbId})`,
        );
        return dup.taskId;
      }
      const cached = this.cachedTorrent(hash);
      if (cached) torrentB64 = cached.toString("base64");
    } else {
      throw new Error(`unsupported bt url: ${url.slice(0, 60)}`);
    }

    const created = (await this.fd.call<{ taskId: string }>("daemon.task.create", {
      request: {
        url: torrentB64 ? "" : magnet,
        saveDir,
        torrentB64: torrentB64 ?? undefined,
        // 归属命名队列（null = 引擎默认；全选接管路径不新建，走 moveTask）
        queueId: queueId ?? undefined,
      },
    })) as { taskId: string };
    // 建后核验：引擎按 infohash 去重（换目录重提 / 控制台同种残留）会移除
    // 占位并发 duplicateTorrent 事件——幂等接管既有任务，或明确报错
    const dup = await this.postCreateVerify(created.taskId);
    if (dup !== null) {
      if (dup === "") {
        throw new Error(
          "该种子已在下载引擎中存在，请稍后重试或从任务列表中查看",
        );
      }
      const survivor = await this.fd
        .call<FdTask>("daemon.task.get", { taskId: dup })
        .catch(() => null);
      const owner = survivor ? this.repo.findByEngineTaskId(dup) : null;
      if (survivor && (!owner || owner.id === dbId)) {
        this.link(dbId, dup, hash, survivor.saveDir, magnet, selectFile);
        logger.info(
          `engine bt create dedup → takeover existing ${dup.slice(0, 8)} for db=${dbId}`,
        );
        return dup;
      }
      throw new Error(
        `该磁力链接已有任务（${owner?.name ?? survivor?.fileName ?? ""}），如需重新下载请先在任务列表中删除原任务`,
      );
    }
    this.link(dbId, created.taskId, hash, saveDir, magnet, selectFile);
    if (hasSubset) {
      logger.info(
        `bt subset submit via fresh-create auto-answer: db=${dbId} select="${selectFile}" (workaround for 0.5.4 paused-only_files deadlock)`,
      );
    }
    await this.pushName(created.taskId, name);
    return created.taskId;
  }

  /**
   * 建后核验（≤5s）：引擎对同 infohash 去重会发 duplicateTorrent 事件（携带
   * existingTaskId）并移除占位任务。返回既有任务 ID（无信号但占位消失 = ""）；
   * 无重复返回 null。（resolveMagnet 与 submitBt 共用）
   *
   * settled：更早的成功信号（resolve 场景 = selectionPending 已到）。
   * 提交场景无此类信号——占位连续两次存活（≥600ms）即视为创建成功
   * （去重判定发生在 add 时刻，存活即未被拒）。
   *
   * settled 信号有 700ms 起始静默：torrentB64 的元数据即时可 settle，
   * 而去重事件（add 时刻即发）可能略滞后到达——没有该窗口会把
   * 「被去重移除的占位」误判为创建成功（session.files 抢跑）。
   */
  private async postCreateVerify(
    engineTaskId: string,
    settled?: () => boolean,
  ): Promise<string | null> {
    const getTask = () =>
      this.fd
        .call<FdTask>("daemon.task.get", { taskId: engineTaskId })
        .catch(() => null as FdTask | null);
    const takeDupSignal = (): string => {
      const dup = this.duplicateOf.get(engineTaskId) ?? "";
      this.duplicateOf.delete(engineTaskId);
      return dup;
    };
    const deadline = Date.now() + 5000;
    const settledAfter = Date.now() + 700;
    let alive = 0;
    while (Date.now() < deadline) {
      if (settled?.() && Date.now() >= settledAfter) return null;
      if (this.duplicateOf.has(engineTaskId)) {
        const dup = takeDupSignal();
        return dup !== "" ? dup : "";
      }
      const t = await getTask();
      if (!t) {
        // 占位消失（duplicate 事件略滞后 / RPC 瞬断）：等 800ms 信号；
        // 复查仍取不到且无信号 → 按无法核验放行（连接级异常自愈走对账）
        await new Promise((r) => setTimeout(r, 800));
        const dup = takeDupSignal();
        if (dup !== "") return dup;
        const again = await getTask();
        if (again) continue;
        return null;
      }
      alive += 1;
      if (alive >= 2 && !settled) return null;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  /** direct（http/ftp/ed2k）任务提交：动态分段加速 + 断点续传全由引擎承担 */
  async submitDirect(
    dbId: number,
    url: string,
    name: string,
    folder: string | null,
    headers: string | null,
    segments: number | null = null,
    queueId: string | null = null,
  ): Promise<string> {
    await this.waitReady();
    const saveDir = this.opts.resolveTaskDir(folder, this.opts.localDir());
    const created = (await this.fd.call<{ taskId: string }>("daemon.task.create", {
      request: {
        url,
        saveDir,
        fileName: name !== "" ? this.opts.sanitizeFilename(name) : undefined,
        headers: parseHeaderLines(headers),
        // 分段数（0/null = segment_advisor 按文件大小自动推荐）
        segments: segments ?? 0,
        // 归属命名队列（null = 引擎默认 main）
        queueId: queueId ?? undefined,
      },
    })) as { taskId: string };
    this.repo.update(dbId, { engineTaskId: created.taskId });
    return created.taskId;
  }

  /** 提交后登记任务会话（selectFile 在 selectionPending 到达时换算应答） */
  private link(
    dbId: number,
    engineTaskId: string,
    hash: string,
    saveDir: string,
    magnet: string,
    selectFile: string | null,
  ): void {
    const session: EngineSession = {
      engineTaskId,
      hash,
      magnet: magnet || undefined,
      saveDir,
      kind: "task",
      dbId,
      selectFile: selectFile ?? undefined,
    };
    this.sessions.set(engineTaskId, session);
    if (hash !== "") this.sessionsByHash.set(hash, session);
    this.repo.update(dbId, { engineTaskId });
    // 回放早到的选择请求（torrentB64 元数据即时，事件可早于注册到达）
    this.replayPendingSelection(session);
  }

  // ---- 任务操作集 ----

  private engineTaskIdOf(dbId: number): string | null {
    const v = this.repo.findById(dbId);
    return v?.engineTaskId ?? null;
  }

  async pause(dbId: number): Promise<void> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return;
    await this.fd.call("daemon.task.pause", { taskId });
  }

  async resume(dbId: number): Promise<void> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return;
    await this.fd.call("daemon.task.resume", { taskId });
  }

  /** 删除引擎任务（deleteFiles 由删除级联契约决定；半成品由引擎清理）。
   *  入参是引擎任务 ID（调用方在删 DB 行前捕获，避免竞态） */
  async delete(engineTaskId: string, deleteFiles: boolean): Promise<void> {
    const session = this.sessions.get(engineTaskId);
    if (session) this.dropSession(session);
    const row = this.repo.findByEngineTaskId(engineTaskId);
    if (row) {
      this.runtimeByDbId.delete(row.id);
      this.lastStatusByDbId.delete(row.id);
      this.lastMirroredNameByDbId.delete(row.id);
      this.speedHistoryByDbId.delete(row.id);
      this.lastSampleAtByDbId.delete(row.id);
      this.queue.removeEngineTask(String(row.id));
    }
    this.segmentsByTask.delete(engineTaskId);
    await this.fd.call("daemon.task.delete", { taskId: engineTaskId, deleteFiles });
  }

  async rename(dbId: number, fileName: string): Promise<void> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return;
    await this.fd.call("daemon.task.rename", { taskId, fileName });
  }

  /** 自定义任务名推到引擎（bt create 只取种子名；引擎侧同步同名后镜像
   *  才不会把 DB 名改回种子名——「任务名称可留空=取种子名」表单语义）。
   *  空名（= 跟随种子名）跳过；改名失败静默降级（镜像一次性改名兜底） */
  private async pushName(engineTaskId: string, name: string): Promise<void> {
    const safe = name.trim() !== "" ? this.opts.sanitizeFilename(name) : "";
    if (safe === "") return;
    await this.fd
      .call("daemon.task.rename", { taskId: engineTaskId, fileName: safe })
      .catch((err: any) =>
        logger.warn(`engine bt rename-on-submit failed: ${err?.message ?? err}`));
  }

  async changeUrl(dbId: number, url: string): Promise<void> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return;
    await this.fd.call("daemon.task.changeUrl", { taskId, url });
  }

  async taskInfo(dbId: number): Promise<FdTask | null> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return null;
    return this.fd.call<FdTask>("daemon.task.get", { taskId }).catch(() => null);
  }

  async taskActivity(dbId: number): Promise<FdTaskActivityLike[]> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) return [];
    const page = await this.fd.call<{ entries: FdTaskActivityLike[] }>(
      "daemon.task.activity",
      { taskId },
    );
    return page?.entries ?? [];
  }

  runtimeOf(dbId: number): EngineRuntimeInfo | undefined {
    return this.runtimeByDbId.get(dbId);
  }

  // ---- 引擎配置代理（设置页「下载引擎」）----

  async configGet(): Promise<FdConfigSnapshot> {
    await this.waitReady();
    return this.fd.call<FdConfigSnapshot>("daemon.config.get");
  }

  async configPatch(values: Record<string, string>): Promise<FdConfigSnapshot> {
    await this.waitReady();
    const snap = await this.configGet();
    return this.fd.call<FdConfigSnapshot>("daemon.config.patch", {
      expectedRevision: snap.revision,
      values,
    });
  }

  async trackerSubscriptionRefresh(): Promise<{ success: boolean; trackerCount: number; error: string }> {
    await this.waitReady();
    return this.fd.call("daemon.bt.trackerSubscription.refresh", {}, 60000);
  }

  /** eD2K 服务器列表订阅刷新（server.met；与 Kad nodes 分开订阅） */
  async ed2kSubscriptionRefresh(): Promise<{
    success: boolean;
    serverCount: number;
    error: string;
  }> {
    await this.waitReady();
    return this.fd.call("daemon.ed2k.serverSubscription.refresh", {}, 60000);
  }

  /** 产物文件跟踪重扫（fileMissing 全量盘点；任务文件被外部移动/删改后找回） */
  async rescanFiles(): Promise<void> {
    await this.waitReady();
    await this.fd.call("daemon.task.rescan", {}, 120000);
  }

  /** 每任务做种限制覆盖（qB 三态语义：-2 跟随全局 / -1 不限 / >=0 自定义；
   *  分享率为千分比；uploadLimitBps 在下次 add 时烘焙生效） */
  async setSeedLimits(
    dbId: number,
    limits: {
      ratioLimitMilli: number;
      postRatioLimitMilli: number;
      seedTimeLimitMinutes: number;
      inactiveTimeLimitMinutes: number;
      uploadLimitBps: number;
    },
  ): Promise<void> {
    await this.waitReady();
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) throw new Error("task is not linked to the engine");
    await this.fd.call("daemon.task.setSeedLimits", { taskId, ...limits });
  }

  /** 批量暂停/恢复引擎任务（UI「全部暂停/开始」；忽略无关联行） */
  async pauseMany(dbIds: number[]): Promise<void> {
    await this.pauseResumeMany(dbIds, "daemon.task.pauseMany");
  }

  async resumeMany(dbIds: number[]): Promise<void> {
    await this.pauseResumeMany(dbIds, "daemon.task.resumeMany");
  }

  private async pauseResumeMany(dbIds: number[], method: string): Promise<void> {
    await this.waitReady();
    const taskIds = dbIds
      .map((id) => this.engineTaskIdOf(id))
      .filter((t): t is string => typeof t === "string" && t !== "");
    if (taskIds.length === 0) return;
    await this.fd.call(method, { taskIds }, 60000);
  }

  /** 全量暂停/恢复引擎任务（对齐控制台「全部暂停/全部恢复」原生口） */
  async pauseAllEngine(): Promise<void> {
    await this.waitReady();
    await this.fd.call("daemon.task.pauseAll", {}, 60000);
  }

  async resumeAllEngine(): Promise<void> {
    await this.waitReady();
    await this.fd.call("daemon.task.resumeAll", {}, 60000);
  }

  /** 目录浏览（新建下载「保存目录」选择器；引擎 fs.list,限 /downloads 子树） */
  async fsList(
    dir: string,
  ): Promise<{
    path: string;
    parent: string;
    denied: boolean;
    dirs: Array<{ name: string; path: string }>;
  }> {
    await this.waitReady();
    const r = await this.fd.call<{
      path: string;
      parent: string;
      denied: boolean;
      dirs: Array<{ name: string; path: string }>;
    }>("daemon.fs.list", { path: dir }, 15000);
    // 安全边界:浏览只允许 /downloads 子树(引擎落盘根),其余一律拒答
    if (typeof r?.path === "string" && r.path !== "/downloads" && !r.path.startsWith("/downloads/")) {
      throw new Error("仅支持浏览 /downloads 目录树");
    }
    return {
      path: r.path,
      parent: r.parent,
      denied: r.denied,
      dirs: (r.dirs ?? []).filter(
        (d) => d.path === "/downloads" || d.path.startsWith("/downloads/"),
      ),
    };
  }

  /** 引擎全局运行统计（事件缓存优先，缺省拉一次 RPC 兜底） */
  async runtimeStatsGet(): Promise<import("../core/fluxdown.ts").FdRuntimeStats | null> {
    if (this.runtimeStats) return this.runtimeStats;
    await this.waitReady();
    return this.fd
      .call<import("../core/fluxdown.ts").FdRuntimeStats>("daemon.runtime.stats")
      .catch(() => null);
  }

  /** 详情抽屉数据：分段快照 + 速度历史（dbId 定位） */
  detailExtras(dbId: number): {
    segments: {
      totalBytes: number;
      segmentCount: number;
      segments: Array<{ index: number; startByte: number; endByte: number; downloadedBytes: number }>;
      at: number;
    } | null;
    speedHistory: Array<{ t: number; bps: number; upBps: number }>;
  } {
    const rt = this.runtimeByDbId.get(dbId);
    const taskId = rt?.taskId ?? this.engineTaskIdOf(dbId) ?? "";
    return {
      segments: this.segmentsByTask.get(taskId) ?? null,
      speedHistory: this.speedHistoryByDbId.get(dbId) ?? [],
    };
  }

  // ---- RSS 订阅代理（daemon.rss.*；纯 RPC 透传，无本地状态）----

  async rssListSources(): Promise<
    import("../core/fluxdown.ts").FdRssSource[]
  > {
    await this.waitReady();
    return this.fd.call("daemon.rss.listSources", {}, 30000);
  }

  async rssGetItems(
    sourceId: string,
  ): Promise<import("../core/fluxdown.ts").FdRssItem[]> {
    await this.waitReady();
    return this.fd.call("daemon.rss.getItems", { sourceId }, 30000);
  }

  async rssCreateSource(
    source: Partial<import("../core/fluxdown.ts").FdRssSource>,
  ): Promise<{ sourceId: string }> {
    await this.waitReady();
    return this.fd.call("daemon.rss.createSource", { ...source }, 30000);
  }

  /** 布尔/单元操作：daemon 统一以 {ok:true} 应答（false → not_found 错误） */
  async rssUpdateSource(
    source: import("../core/fluxdown.ts").FdRssSource,
  ): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.rss.updateSource", { ...source }, 30000);
  }

  async rssDeleteSource(sourceId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.rss.deleteSource", { sourceId }, 30000);
  }

  async rssRefreshSource(sourceId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.rss.refreshSource", { sourceId }, 60000);
  }

  async rssItemAction(
    sourceId: string,
    guid: string,
    action: "download" | "ignore" | "readAll",
  ): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call(
      "daemon.rss.itemAction",
      { sourceId, guid, action },
      60000,
    );
  }

  /** feed 地址验证（只读、不落库；失败原因在 error 字段里） */
  async rssValidate(req: {
    url: string;
    cookies?: string;
    userAgent?: string;
    proxyUrl?: string;
  }): Promise<{
    url: string;
    feedTitle: string;
    items: import("../core/fluxdown.ts").FdRssItem[];
    error: string;
  }> {
    await this.waitReady();
    return this.fd.call("daemon.rss.validate", { ...req }, 60000);
  }

  // ---- 命名队列（daemon.queue.*）----
  // 0.5.4 实证：create 收 {name}；update 仅接受 {queueId,name}（DTO 限速/
  // 排程字段一律 invalidArgument）；schedule/reorder 为无效面不接入；
  // moveTask/boost 真实生效；task.create 的 request.queueId 决定归属队列。

  async queueList(): Promise<import("../core/fluxdown.ts").FdQueue[]> {
    await this.waitReady();
    return this.fd.call("daemon.queue.list", {}, 30000);
  }

  /** 建队列（返回 {ok:true}；新 queueId 需经 queueList 取回） */
  async queueCreate(name: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.create", { name }, 30000);
  }

  /** 队列改名（0.5.4 唯一可用的更新面） */
  async queueUpdate(
    queueId: string,
    name: string,
  ): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.update", { queueId, name }, 30000);
  }

  async queueDelete(queueId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.delete", { queueId }, 30000);
  }

  /** 恢复队列调度（isRunning=true） */
  async queueStart(queueId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.start", { queueId }, 30000);
  }

  /** 暂停队列调度（isRunning=false；已在途的任务继续，新任务排队） */
  async queueStop(queueId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.stop", { queueId }, 30000);
  }

  /** 把引擎任务挪入指定队列 */
  async queueMoveTask(
    queueId: string,
    taskId: string,
  ): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.moveTask", { queueId, taskId }, 30000);
  }

  /** 任务插队（队列内提到队首优先调度） */
  async queueBoost(taskId: string): Promise<{ ok: boolean }> {
    await this.waitReady();
    return this.fd.call("daemon.queue.boost", { taskId }, 30000);
  }

  /** DB 任务挪入指定队列（engineTaskIdOf 解析；成功后 DB 行同步归属） */
  async queueMoveTaskForDb(
    dbId: number,
    queueId: string,
  ): Promise<{ ok: boolean }> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) throw new Error("任务没有引擎关联（仅引擎任务可换队列）");
    const r = await this.queueMoveTask(queueId, taskId);
    // DB 行同步归属（重提保真；引擎仍是事实源）
    this.repo.update(dbId, { queueId });
    return r;
  }

  /** DB 任务插队（队列内提到队首优先调度） */
  async queueBoostForDb(dbId: number): Promise<{ ok: boolean }> {
    const taskId = this.engineTaskIdOf(dbId);
    if (!taskId) throw new Error("任务没有引擎关联（仅引擎任务可插队）");
    return this.queueBoost(taskId);
  }

  // ---- 事件驱动同步 ----

  private onEvent(e: FdDaemonEvent): void {
    // 联合带 string 逃逸成员（未知事件前向兼容），在分发处一次收窄
    const ev = e as { type: string; data: any };
    switch (ev.type) {
      case "snapshot":
        if (ev.data?.runtimeStats) {
          this.runtimeStats = ev.data.runtimeStats;
        }
        void this.reconcile(ev.data.tasks as FdTask[]);
        break;
      case "selectionPending":
        this.onSelection(ev.data as import("../core/fluxdown.ts").FdSelectionRequest);
        break;
      case "selectionResolved":
        // 解析会话超时（默认全量触发）：会话标记过期，提交时重建
        for (const s of this.sessions.values()) {
          if (
            s.kind === "resolve" &&
            s.pendingRequestId === (ev.data as { requestId: string }).requestId
          ) {
            s.expired = true;
          }
        }
        break;
      case "taskChanged":
        this.onTaskChanged(ev.data as FdTask);
        break;
      case "taskDeleted":
        this.onTaskDeleted((ev.data as { taskId: string }).taskId);
        break;
      case "runtimeStatsChanged":
        // 引擎全局统计（活跃任务/总速度/磁盘剩余）：缓存，engine-stats 消费
        this.runtimeStats = ev.data as import("../core/fluxdown.ts").FdRuntimeStats;
        break;
      default: {
        // engine 通道的细分事件：taskProgress（实时速度/做种）/
        // duplicateTorrent（占位被拒，携带既有任务）/
        // taskRuntimeChanged（节点数）/ segmentProgress（分段进度）
        if (ev.type === "engine" && typeof ev.data === "object" && ev.data !== null) {
          const m = ev.data as { type?: string } & Record<string, unknown>;
          if (m.type === "taskProgress") {
            // WsServerMsg 内部标签 + 平铺字段：进度对象即 m 本身（无嵌套 data）
            this.onProgress(m as unknown as FdTaskProgress);
          } else if (m.type === "tasksSnapshot") {
            // 引擎主动全量广播（任务级联变化）：走同一对账路径
            void this.reconcile(m.tasks as FdTask[]);
          } else if (m.type === "segmentProgress") {
            // 分段级进度（详情抽屉分段可视化；只留最新快照）
            this.segmentsByTask.set(String(m.taskId ?? ""), {
              totalBytes: Number(m.totalBytes ?? 0),
              segmentCount: Number(m.segmentCount ?? 0),
              segments: (Array.isArray(m.segments) ? m.segments : []) as Array<{
                index: number;
                startByte: number;
                endByte: number;
                downloadedBytes: number;
              }>,
              at: Date.now(),
            });
          } else if (m.type === "duplicateTorrent" && typeof m.taskId === "string") {
            this.duplicateOf.set(m.taskId, String(m.existingTaskId ?? ""));
          } else if (m.type === "taskRuntimeChanged" && typeof m.taskId === "string") {
            this.peersByEngineTask.set(m.taskId, {
              peers: (m.connectedPeers as number | null) ?? null,
              activeTransfers: (m.activeTransfers as number | null) ?? null,
            });
          }
        }
        break;
      }
    }
  }

  /** 选择请求路由：解析会话挂起等表单；任务会话按 selectFile 自动应答；
   *  非本桥接创建的任务（引擎控制台/AriaNg）不代答（控制台自己有 UI） */
  private onSelection(req: import("../core/fluxdown.ts").FdSelectionRequest): void {
    const session = this.sessions.get(req.taskId);
    if (!session) {
      // 桥接竞态缓冲：torrentB64 元数据即时，selectionPending 可能在 create
      // 响应往返/建后核验（~600ms）期间先行到达，而 link() 注册在其后——
      // 直接丢弃会错过子集应答（引擎 60s 默认全量，实测 Sintel 全量下载）。
      // 缓冲待注册点回放；非桥接任务无人认领，由引擎默认应答兜底
      this.bufferSelection(req);
      return;
    }
    session.pendingRequestId = req.requestId;
    this.dispatchSelection(session, req);
  }

  /** 早到选择请求缓冲（TTL 收敛：引擎 60s 默认应答后回放无意义） */
  private bufferSelection(req: import("../core/fluxdown.ts").FdSelectionRequest): void {
    if (this.pendingSelections.size > 64) {
      const cutoff = Date.now() - 70_000;
      for (const [k, v] of this.pendingSelections) {
        if (v.at < cutoff) this.pendingSelections.delete(k);
      }
    }
    this.pendingSelections.set(req.taskId, { req, at: Date.now() });
  }

  /** 注册点回放早到的选择请求（link() 与解析会话注册共用） */
  private replayPendingSelection(session: EngineSession): void {
    const early = this.pendingSelections.get(session.engineTaskId);
    if (!early) return;
    this.pendingSelections.delete(session.engineTaskId);
    session.pendingRequestId = early.req.requestId;
    this.dispatchSelection(session, early.req);
  }

  /** 选择请求应答分发（会话已登记；即时到达与回放共用） */
  private dispatchSelection(
    session: EngineSession,
    req: import("../core/fluxdown.ts").FdSelectionRequest,
  ): void {
    if (session.kind === "resolve" && req.kind.type === "bt") {
      // 解析会话：文件清单就绪（引擎已挂起等待，60s deadline）
      session.files = req.kind.files;
      if (session.waiter) {
        const w = session.waiter;
        session.waiter = undefined;
        clearTimeout(w.timer);
        w.resolve(req.kind.files);
      }
      return;
    }

    // 任务会话：BT 文件选择按 selectFile 换算应答；其余种类
    //（fileExists/hls/variant）按引擎 defaultChoice 决定（file_exists_behavior 配置语义）
    if (req.kind.type === "bt" && session.kind === "task") {
      const fileCount = req.kind.files.length;
      const indices = session.selectFile
        ? selectFileToIndices(session.selectFile, fileCount)
        : undefined;
      void this.fd
        .call("daemon.selection.resolve", {
          requestId: req.requestId,
          outcome: { kind: "bt", indices: indices ?? [] },
        })
        .then(() => {
          logger.info(
            `engine bt selection answered: ${indices ? `${indices.length}/${fileCount} files` : "all files"} (db=${session.dbId})`,
          );
          // 子集应答后启动解卡看门狗（FluxDown 0.5.4 已知缺陷，见方法注释）
          if (indices && indices.length > 0 && indices.length < fileCount) {
            void this.subsetUnstickWatchdog(req.taskId, session.dbId ?? null);
          }
        })
        .catch((err: any) =>
          logger.warn(`engine bt selection answer failed: ${err?.message ?? err}`));
      return;
    }
    void this.fd
      .call("daemon.selection.resolve", {
        requestId: req.requestId,
        outcome: req.defaultChoice,
      })
      .catch(() => {});
  }

  /**
   * 子集应答后的解卡看门狗 —— FluxDown 0.5.4 已知缺陷的集成侧规避。
   *
   * 根因（native/engine/src/bt_downloader.rs Phase 3.5）：Path B 选择对话框
   * 打开时引擎后台循环把种子 pause（防「全部文件」抢跑）；子集应答后
   * apply_only_files_after_init 里的 update_only_files 在 paused 句柄上无限
   * 挂起（其 200ms 取消竞速只保护 wait_until_initialized，不保护 update 调
   * 用），任务停在「准备中 + 零字节」，对话框恢复逻辑（unpause）永远到不了。
   * 上游 main 尚未修复；daemon RPC 无子集预选通道（selectedFileIndices 是
   * 桌面 Dart 路径独有字段），故只能应答后补救。
   *
   * 实测（2026-10-09，Sintel 11 文件选 1）：daemon.task.pause → resume 能
   * 唤醒会话 manage loop 放行挂起的 await，任务随后带子集正常下载
   *（totalBytes 收敛为所选文件大小，未选文件仅稀疏占位）。冻结是任务级
   * 的：引擎事件管道与其它任务不受影响，RPC 全程可用。
   *
   * 仅在冻结特征（引擎状态 = 准备中 + 零字节）确认后介入；用户手动暂停
   * （状态 2）/正常下载/已完成/已删除均不触发，健康任务零打扰。
   */
  private async subsetUnstickWatchdog(
    engineTaskId: string,
    dbId: number | null,
  ): Promise<void> {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const get = () =>
      this.fd
        .call<import("../core/fluxdown.ts").FdTask>("daemon.task.get", {
          taskId: engineTaskId,
        })
        .catch(() => null);
    const frozen = async (): Promise<boolean | null> => {
      const t = await get();
      if (!t) return null; // 任务已删（引擎/用户侧）→ 退出
      if (
        t.status === FD_TASK_STATUS.downloading ||
        t.status === FD_TASK_STATUS.paused || // 用户暂停：不碰
        t.status === FD_TASK_STATUS.completed ||
        t.status === FD_TASK_STATUS.error ||
        (t.downloadedBytes ?? 0) > 0
      ) {
        return false;
      }
      return t.status === FD_TASK_STATUS.preparing; // 仅「准备中 + 零字节」= 冻结特征
    };

    await delay(6000); // 留出正常路径窗口（元数据校验 + apply + 进度循环启动）
    for (let round = 1; round <= 3; round++) {
      const f = await frozen();
      if (f !== true) return;
      logger.warn(
        `engine bt task ${engineTaskId.slice(0, 8)} frozen after subset selection (preparing, 0 bytes) — unstick pause+resume (round ${round})`,
      );
      await this.fd
        .call("daemon.task.pause", { taskId: engineTaskId })
        .catch(() => {});
      await delay(2500);
      await this.fd
        .call("daemon.task.resume", { taskId: engineTaskId })
        .catch(() => {});
      await delay(9000);
    }
    if ((await frozen()) === true) {
      logger.error(
        `engine bt task ${engineTaskId.slice(0, 8)} unstick failed after 3 rounds — marking failed (FluxDown 0.5.4 subset-selection deadlock)`,
      );
      if (dbId !== null) {
        this.repo.update(dbId, { status: "failed" });
        this.fireLifecycle(dbId, "failed", "引擎文件选择应用卡死（fluxdown 0.5.4 已知缺陷），请重试或改选全部文件");
      }
    }
  }

  /** 实时进度：更新内存 runtime（/api/tasks 附加字段），不落库不广播
   *  （UI 1s 轮询 /api/tasks 取进度，与既有下载队列行为一致） */
  private onProgress(p: FdTaskProgress): void {
    const dbId = this.dbIdOfEngineTask(p.taskId);
    if (dbId === null) return;
    // 速度历史采样（≥3s 一采，保留 120 点 ≈ 6 分钟；详情抽屉曲线数据）
    const lastAt = this.lastSampleAtByDbId.get(dbId) ?? 0;
    const now = Date.now();
    if (now - lastAt >= 3000) {
      this.lastSampleAtByDbId.set(dbId, now);
      const hist = this.speedHistoryByDbId.get(dbId) ?? [];
      hist.push({ t: now, bps: p.speed, upBps: p.uploadSpeed });
      if (hist.length > 120) hist.splice(0, hist.length - 120);
      this.speedHistoryByDbId.set(dbId, hist);
    }
    const percent =
      p.totalBytes > 0 ? Math.round((p.downloadedBytes / p.totalBytes) * 1000) / 10 : 0;
    this.runtimeByDbId.set(dbId, {
      taskId: p.taskId,
      status: p.status,
      percent,
      speed: fmtSpeedBps(p.speed),
      uploadSpeed: fmtSpeedBps(p.uploadSpeed),
      uploadedBytes: p.uploadedBytes,
      downloadedBytes: p.downloadedBytes,
      totalBytes: p.totalBytes,
      seeding: p.seedingStatus,
      seedingMessage: p.seedingMessage,
      seedingTimeSecs: p.seedingTimeSecs,
      ...(this.peersByEngineTask.get(p.taskId) ?? {}),
    });
    // daemon 只经进度帧广播引擎状态变化（不为下载完成/失败发 taskChanged，
    // 见 native/agent/src/task_events.rs：只转发 TaskProgress/TasksSnapshot）——
    // DB 状态镜像与生命周期 SSE 必须由进度帧驱动
    this.mirrorEngineTask(dbId, p.status, p.fileName, p.errorMessage);
    this.reportQueueInfo(dbId, p);
  }

  /** 引擎状态/名称镜像（进度帧与 taskChanged 共用）：
   *  状态迁移落库 + 生命周期 SSE；BT 真名回写（磁力 dn 占位 → metadata 真名） */
  private mirrorEngineTask(
    dbId: number,
    engineStatus: number,
    fileName: string,
    errorMessage: string,
  ): void {
    const status = mapStatus(engineStatus);
    const prev = this.lastStatusByDbId.get(dbId) ?? "";
    const row = this.repo.findById(dbId);
    if (!row) return;

    if (row.type === "bt" && fileName !== "" && fileName !== row.name) {
      // 同一 fileName 只触发改名一次（用户在控制台改名/种子名就绪各一次）；
      // 重复触发时 row.name 已带去重后缀、必然 ≠ fileName，会无限循环改名
      if (this.lastMirroredNameByDbId.get(dbId) !== fileName) {
        this.lastMirroredNameByDbId.set(dbId, fileName);
        let next = this.opts.sanitizeFilename(fileName);
        if (next !== "" && next !== row.name) {
          const dup = this.repo.findByName(next);
          if (dup && dup.id !== dbId) next = `${next}-${this.opts.randomName()}`;
          try {
            this.repo.update(dbId, { name: next });
            logger.info(`engine bt task ${dbId} renamed to "${next}"`);
          } catch (err: any) {
            logger.warn(`engine bt rename failed id=${dbId}: ${err?.message ?? err}`);
          }
        }
      }
    }

    if (prev === status) return;
    this.lastStatusByDbId.set(dbId, status);
    try {
      this.repo.updateStatus([dbId], status);
    } catch (err: any) {
      logger.warn(`engine status sync failed id=${dbId}: ${err?.message ?? err}`);
    }
    this.fireLifecycle(dbId, status, errorMessage);
  }

  /** 任务状态/名称变更（daemon 级 taskChanged：创建/删除/队列操作） */
  private onTaskChanged(t: FdTask): void {
    const dbId = this.dbIdOfEngineTask(t.taskId);
    if (dbId === null) return;
    this.mirrorEngineTask(dbId, t.status, t.fileName, t.errorMessage);
    this.reportQueueInfo(dbId, null, t);
  }

  private onTaskDeleted(taskId: string): void {
    const session = this.sessions.get(taskId);
    this.sessions.delete(taskId);
    this.pendingSelections.delete(taskId);
    if (session && this.sessionsByHash.get(session.hash) === session) {
      this.sessionsByHash.delete(session.hash);
    }
    const dbId = this.dbIdOfEngineTask(taskId);
    if (dbId === null) return;
    const row = this.repo.findById(dbId);
    // 引擎侧被删（控制台操作）：未完成记录转 stopped；已完成记录保留
    //（exists 检查会反映文件去留）
    if (row && row.status !== "success") {
      this.lastStatusByDbId.set(dbId, "stopped");
      try {
        this.repo.updateStatus([dbId], "stopped");
      } catch {
        // 记录可能已被 UI 删除
      }
      this.hub.broadcast("download-stop", { id: String(dbId) });
    }
    this.queue.removeEngineTask(String(dbId));
    this.runtimeByDbId.delete(dbId);
    this.lastMirroredNameByDbId.delete(dbId);
  }

  private fireLifecycle(dbId: number, status: string, errorMessage: string): void {
    const id = String(dbId);
    if (status === "downloading") {
      void this.logs?.append(id, "Task started (fluxdown engine)");
      this.hub.broadcast("download-start", { id });
    } else if (status === "success") {
      void this.logs?.append(id, "Task completed successfully");
      this.hub.broadcast("download-success", { id });
    } else if (status === "failed") {
      void this.logs?.append(id, `Task failed: ${errorMessage}`);
      this.hub.broadcast("download-failed", { id, error: errorMessage });
    } else if (status === "stopped") {
      void this.logs?.append(id, "Task stopped");
      this.hub.broadcast("download-stop", { id });
    }
  }

  /** 向队列视图注入引擎任务信息（/api/tasks 消费；UI 1s 轮询取进度） */
  private reportQueueInfo(dbId: number, progress: FdTaskProgress | null, task?: FdTask): void {
    const row = this.repo.findById(dbId);
    if (!row) return;
    const rt = this.runtimeByDbId.get(dbId);
    const status = this.lastStatusByDbId.get(dbId) ?? row.status;
    let percent = rt?.percent ?? 0;
    let speed = rt?.speed ?? "";
    if (progress) {
      percent =
        progress.totalBytes > 0
          ? Math.round((progress.downloadedBytes / progress.totalBytes) * 1000) / 10
          : 0;
      speed = fmtSpeedBps(progress.speed);
    } else if (task && task.totalBytes > 0) {
      percent = Math.round((task.downloadedBytes / task.totalBytes) * 1000) / 10;
    }
    const info: TaskInfo & { engine?: Record<string, unknown> } = {
      id: String(dbId),
      type: row.type as TaskInfo["type"],
      url: row.url,
      name: row.name,
      status: status as TaskInfo["status"],
      percent,
      speed,
      isLive: false,
      engine: rt
        ? {
            taskId: rt.taskId,
            uploadSpeed: rt.uploadSpeed,
            uploadedBytes: rt.uploadedBytes,
            downloadedBytes: rt.downloadedBytes,
            totalBytes: rt.totalBytes,
            seeding: rt.seeding,
            seedingStatus: FD_SEEDING_STATUS,
            seedingMessage: rt.seedingMessage,
            seedingTimeSecs: rt.seedingTimeSecs,
          }
        : undefined,
    };
    if (info.engine && task) {
      info.engine.uploadedBytes = task.uploadedBytes;
      info.engine.seeding = task.seedingStatus;
      info.engine.seedingMessage = task.seedingMessage;
      info.engine.seedingTimeSecs = task.seedingTimeSecs;
    }
    this.queue.reportEngineTask(info);
  }

  /** engineTaskId → dbId（会话缓存 → DB 兜底） */
  private dbIdOfEngineTask(taskId: string): number | null {
    const session = this.sessions.get(taskId);
    if (session?.dbId) return session.dbId;
    const row = this.repo.findByEngineTaskId(taskId);
    if (row) {
      // 断线重连/重启后恢复关联（会话由 reconcile 重建）
      if (!session) {
        const s: EngineSession = {
          engineTaskId: taskId,
          hash: btHashOf(row.url),
          saveDir: "",
          kind: "task",
          dbId: row.id,
        };
        this.sessions.set(taskId, s);
      }
      return row.id;
    }
    return null;
  }

  /**
   * 全量对账（握手成功 / snapshot 事件 / 重连后）：
   * - DB 引擎任务在引擎中已消失 → 转 stopped（引擎侧删除/会话丢失）
   * - 活动引擎任务恢复队列视图注入与状态镜像
   * - 孤儿收养：落盘在下载目录树内但无 DB 关联的引擎任务（解析会话超期
   *   无人认领 / 控制台手加到下载根）→ 建 DB 行纳入下载中心管理
   */
  private async reconcile(tasks?: FdTask[]): Promise<void> {
    let list: FdTask[];
    if (tasks) {
      list = tasks;
    } else {
      try {
        list = await this.fd.call<FdTask[]>("daemon.task.list");
      } catch (err: any) {
        logger.warn(`engine reconcile list failed: ${err?.message ?? err}`);
        return;
      }
    }
    const engineIds = new Set(list.map((t) => t.taskId));
    // DB 侧：引擎任务关联但引擎中不存在 → stopped
    try {
      const linked = this.repo.findEngineLinked();
      for (const row of linked) {
        if (!row.engineTaskId || engineIds.has(row.engineTaskId)) continue;
        if (row.status === "downloading" || row.status === "pending") {
          this.repo.updateStatus([row.id], "stopped");
          this.lastStatusByDbId.set(row.id, "stopped");
          this.hub.broadcast("download-stop", { id: String(row.id) });
          logger.warn(`engine task missing for db ${row.id} (${row.name}), marked stopped`);
        }
      }
    } catch (err: any) {
      logger.warn(`engine reconcile db scan failed: ${err?.message ?? err}`);
    }
    // 引擎侧：镜像状态 + 恢复队列视图 + 孤儿收养
    const root = this.downloadRoot();
    for (const t of list) {
      const row = this.repo.findByEngineTaskId(t.taskId);
      if (row) {
        this.onTaskChanged(t);
        continue;
      }
      // 解析会话（未提交）不收养——表单取消/提交时自决
      if (this.sessions.get(t.taskId)) continue;
      // 孤儿收养：落盘目录在下载树内（root 前缀）且产物已存在/在下载的
      // 引擎任务 → 建 DB 行（url: 磁力/直链/种子哨兵；folder: saveDir 相对 root）
      if (root !== "" && t.saveDir.startsWith(root + "/")) {
        this.adoptEngineTask(t);
      }
    }
  }

  /** 孤儿引擎任务收养：无 DB 关联但落盘在下载树内 → 建 DB 行并镜像状态 */
  private adoptEngineTask(t: FdTask): void {
    try {
      if (this.repo.findByEngineTaskId(t.taskId)) {
        this.onTaskChanged(t);
        return;
      }
      // 年龄守卫：刚建 <10s 的引擎任务不收养——它可能是正被去重移除的
      // 占位（占位存活 <2s，收了就是僵尸行）；稳定任务由后续对账收编
      const createdSec = Number.parseInt(t.createdAt, 10);
      if (Number.isFinite(createdSec) && Date.now() / 1000 - createdSec < 10) {
        return;
      }
      const root = this.downloadRoot();
      const folder =
        root !== "" && t.saveDir.startsWith(root + "/")
          ? t.saveDir.slice(root.length + 1) || null
          : null;
      const isBt =
        /^magnet:/i.test(t.url) || t.url === "torrent-file://local" || t.seedingStatus > 0;
      const name =
        t.fileName !== ""
          ? this.opts.sanitizeFilename(t.fileName)
          : `engine-${t.taskId.slice(0, 8)}`;
      const dup = this.repo.findByName(name);
      const finalName = dup ? `${name}-${this.opts.randomName()}` : name;
      const created = this.repo.create({
        name: finalName,
        type: isBt ? "bt" : "direct",
        url: t.url,
        folder,
        headers: null,
        isLive: false,
        status: "stopped",
        selectFile: null,
        segments: null,
        // 归属队列跟随引擎快照（adopt 是孤儿接管，保留原队列归属）
        queueId: t.queueId || null,
        engineTaskId: t.taskId,
      });
      logger.info(
        `engine orphan task adopted: ${t.taskId.slice(0, 8)} → db ${created.id} (${finalName})`,
      );
      this.onTaskChanged(t);
    } catch (err: any) {
      logger.warn(
        `engine orphan adoption failed (${t.taskId.slice(0, 8)}): ${err?.message ?? err}`,
      );
    }
  }

  /** 下载目录树根（localDir 的父目录；部署 = /downloads） */
  private downloadRoot(): string {
    const local = this.opts.localDir();
    const idx = local.lastIndexOf("/");
    if (idx <= 0) return "";
    return local.slice(0, idx);
  }
}

interface FdTaskActivityLike {
  id: number;
  kind: string;
  message: string;
  status?: number;
  taskId: string;
  timestampMs: number;
}

/** 磁力 dn 参数（显示名兜底） */
function magnetDisplayNameOf(magnet: string): string | null {
  const m = /[?&]dn=([^&]+)/.exec(magnet);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}
