// core/fluxdown —— FluxDown 下载引擎客户端（下载中心统一执行引擎）
//
// FluxDown（zerx-lab/FluxDown，AGPL-3.0）是 Rust + Tokio 的多协议下载器：
// HTTP/FTP 动态分段加速、BitTorrent/磁力（librqbit：DHT/PEX/MSE/UPnP）、
// eD2K（Kad）、HLS/DASH 流媒体。本模块是其 headless 服务
//（fluxdown-agent --server，容器内 127.0.0.1:17800）的接入客户端：
//
// - 传输层：`/rpc` WebSocket JSON-RPC 2.0（子协议鉴权：fluxdown.rpc.v1 +
//   fluxdown.token.<base64url(token)>）。hello → snapshot → service.event 增量
//   事件流；4009 关闭码 = 事件缺口需重新 snapshot。
// - REST（`/api/v1/*`，X-FluxDown-Token 头）仅用于探活与兜底查询；任务操作
//   全走 WS（选择协议 selectionPending 只在 WS 上推送）。
// - 事件帧形状（agent 前置形态）：params.event = {service:'agent',
//   event:{type:'daemon', data:{type:'<DaemonEvent>', data}}}。
//
// 线协议实证依据（2026-10-09，FluxDown-Server 0.5.4 本地实测）：
//   hello/snapshot/selection subscribe→pending→resolve/ taskProgress（实时
//   speed/uploadSpeed/seedingStatus）/ taskChanged / config get+patch（revision）
//   / pause/resume/delete/activity / REST 创建与列表 / aria2 兼容 /jsonrpc。

import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.ts";

// ---- wire 类型（镜像 FluxDown web 协议定义，字段名保持原样）----

/** 任务状态：0 待处理 / 1 下载中 / 2 已暂停 / 3 已完成 / 4 出错 / 5 准备中 */
export const FD_TASK_STATUS = {
  pending: 0,
  downloading: 1,
  paused: 2,
  completed: 3,
  error: 4,
  preparing: 5,
} as const;
export type FdTaskStatus = (typeof FD_TASK_STATUS)[keyof typeof FD_TASK_STATUS];

/** 做种状态：0 无 / 1 做种中 / 2 达分享率 / 3 达时长 / 4 用户停止 /
 * 5 任务删除 / 6 会话释放 / 7 不活跃停止 / 8 排队等待做种槽 */
export const FD_SEEDING_STATUS = {
  none: 0,
  seeding: 1,
  ratioReached: 2,
  timeReached: 3,
  userStopped: 4,
  taskDeleted: 5,
  sessionReleased: 6,
  inactiveStopped: 7,
  queued: 8,
} as const;

/** 引擎任务（daemon.task.list / get / taskChanged 事件） */
export interface FdTask {
  taskId: string;
  url: string;
  fileName: string;
  saveDir: string;
  status: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage: string;
  createdAt: string;
  proxyUrl: string;
  queueId: string;
  checksum: string;
  ignoreTlsErrors: boolean;
  fileMissing: boolean;
  completedAt: string;
  referrer: string;
  groupId: string;
  rssSourceId: string;
  originUrl: string;
  autoRoute: string;
  queueOrder: number;
  uploadedBytes: number;
  uploadedAtCompletion: number;
  seedingStatus: number;
  seedingMessage: string;
  seedingTimeSecs: number;
  seedRatioLimitMilli: number;
  seedPostRatioLimitMilli: number;
  seedTimeLimitMinutes: number;
  seedInactiveTimeLimitMinutes: number;
}

/** 引擎实时进度（engine taskProgress 事件；TaskDto 无 speed 字段） */
export interface FdTaskProgress {
  type: "taskProgress";
  taskId: string;
  status: number;
  downloadedBytes: number;
  totalBytes: number;
  /** 字节/秒 */
  speed: number;
  /** BT 上传速率（字节/秒） */
  uploadSpeed: number;
  fileName: string;
  saveDir: string;
  url: string;
  /** status==4 且 errorMessage=="deleted" 表示任务已被删除 */
  errorMessage: string;
  uploadedBytes: number;
  seedingStatus: number;
  seedingMessage: string;
  seedingTimeSecs: number;
}

/** BT 选择请求文件条目（0-based 索引） */
export interface FdBtFile {
  index: number;
  path: string;
  size: number;
}

/** 待选择请求（selectionPending 事件 / pendingSelections 快照） */
export interface FdSelectionRequest {
  requestId: string;
  taskId: string;
  kind:
    | { type: "hls"; options: Array<{ index: number; bandwidth: number; width: number; height: number }> }
    | { type: "bt"; files: FdBtFile[] }
    | { type: "variant"; options: Array<{ index: number; label: string; container: string; totalBytes: number }> }
    | {
        type: "fileExists";
        fileName: string;
        saveDir: string;
        existingSize?: number;
        existingModifiedUnixMs?: number;
        incomingSize?: number;
        renamePreview: string;
        actions: Array<"rename" | "overwrite" | "skip">;
      };
  defaultChoice: { kind: "hls" | "bt" | "variant" | "fileExists" } & Record<string, unknown>;
  deadlineUnixMs: number;
}

/** daemon 配置快照（revision 乐观锁：patch 必须带 expectedRevision） */
export interface FdConfigSnapshot {
  revision: number;
  values: Record<string, string>;
}

/** daemon 运行统计（runtimeStatsChanged / daemon.runtime.stats） */
export interface FdRuntimeStats {
  activeTasks: number;
  pendingTasks: number;
  retryPendingTasks?: number;
  totalDownloadBps: number;
  totalUploadBps: number;
  diskFreeBytes: number | null;
  saveDir: string;
}

/** 任务活动日志条目 */
export interface FdTaskActivity {
  id: number;
  kind: string;
  message: string;
  status?: number;
  taskId: string;
  timestampMs: number;
}

/** RSS 订阅源（daemon.rss.*；字段镜像 RssSourceDto） */
export interface FdRssSource {
  sourceId: string;
  providerId?: string;
  providerConfig?: string;
  url: string;
  name: string;
  enabled: boolean;
  /** false = 收集模式（只收集条目供手动挑选） */
  autoDownload: boolean;
  /** 自动创建的任务以 paused 落库 */
  startPaused: boolean;
  queueId: string;
  saveDir: string;
  /** 抓取间隔（分钟）；0 = 引擎默认 30 */
  intervalMinutes: number;
  /** 包含关键词（"|" = 或，空格 = 且；空 = 不过滤） */
  includePattern: string;
  excludePattern: string;
  useRegex: boolean;
  smartEpisode: boolean;
  sizeMinBytes: number;
  sizeMaxBytes: number;
  sendReferer: boolean;
  notifyOnDownload: boolean;
  /** 每轮最多新建任务数（1..=100）；0 = 引擎默认 20 */
  maxPerFetch: number;
  cookies: string;
  userAgent: string;
  proxyUrl: string;
  lastFetchAt: number;
  lastSuccessAt: number;
  lastError: string;
  failCount: number;
  seeded: boolean;
  position: number;
  unreadCount: number;
}

/** RSS 条目（daemon.rss.getItems） */
export interface FdRssItem {
  sourceId: string;
  guid: string;
  title: string;
  link: string;
  enclosureUrl: string;
  enclosureLength: number;
  pubDate: number;
  fetchedAt: number;
  /** 0=新 1=已下载 2=已忽略 3=规则未命中 4=重复剧集 5=首轮历史 */
  status: number;
  taskId: string;
  episodeKey: string;
  reason: string;
}

/** 下载队列（daemon.queue.list；0.5.4 实证：update 仅接受 queueId+name） */
export interface FdQueue {
  queueId: string;
  name: string;
  position: number;
  /** false = 队列暂停（新任务不调度） */
  isRunning: boolean;
  maxConcurrent: number;
  defaultSaveDir: string;
  defaultSegments: number;
  defaultUserAgent: string;
  /** 下载限速（KB/s；0 = 不限） */
  speedLimitKbps: number;
  /** 上传限速（KB/s；0 = 不限） */
  uploadLimitKbps: number;
  scheduleEnabled: boolean;
  /** 位掩码：1=周日 … 64=周六；127 = 每天 */
  scheduleDays: number;
  scheduleStart: string;
  scheduleStop: string;
}

/** daemon 事件（service.event 拆包后）——桥接层消费的子集；snapshot 为
 * 握手/重连后的合成事件（携 daemon 投影，供桥接层全量对账） */
export type FdDaemonEvent =
  | { type: "snapshot"; data: FdSnapshotDaemon }
  | { type: "taskChanged"; data: FdTask }
  | { type: "taskDeleted"; data: { taskId: string } }
  | { type: "engine"; data: { type: "taskProgress"; data: FdTaskProgress } | { type: string; data: unknown } }
  | { type: "selectionPending"; data: FdSelectionRequest }
  | { type: "selectionResolved"; data: { requestId: string } }
  | { type: "runtimeStatsChanged"; data: FdRuntimeStats }
  | { type: "configChanged"; data: FdConfigSnapshot }
  | { type: string; data: unknown };

/** daemon.* 方法返回的应用错误（JSON-RPC error.data.code） */
export class FluxDownError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, code = "internal", retryable = false) {
    super(message);
    this.name = "FluxDownError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** 引擎不可达（未启动 / 重连中）——调用方转用户可读错误 */
export class FluxDownUnavailableError extends Error {
  constructor(message = "下载引擎不可用（fluxdown 未启动或正在重启）") {
    super(message);
    this.name = "FluxDownUnavailableError";
  }
}

// ---- 连接配置 ----

export interface FluxDownOptions {
  /** 容器内引擎地址（默认 http://127.0.0.1:17800） */
  baseUrl?: string;
  /** 访问密钥（与引擎控制台 / aria2 兼容 RPC 共用） */
  token: string;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * 读取引擎访问密钥：FLUXDOWN_TOKEN 环境变量（supervisord 注入）优先，
 * 回落数据目录 token 文件（entrypoint 首启生成）。两者都没有 = 引擎未初始化。
 */
export function loadFluxDownToken(dataDir: string): string {
  const env = process.env.FLUXDOWN_TOKEN;
  if (typeof env === "string" && env !== "") return env;
  try {
    const t = fs.readFileSync(path.join(dataDir, "token"), "utf8").trim();
    if (t !== "") return t;
  } catch {
    // 文件不存在：由调用方决定是否报错
  }
  return "";
}

// ---- 客户端 ----

type PendingCall = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
};

export interface FdSnapshotDaemon {
  tasks: FdTask[];
  taskRuntime: Record<string, unknown>;
  config: FdConfigSnapshot;
  runtimeStats: FdRuntimeStats;
  pendingSelections: FdSelectionRequest[];
}

/**
 * FluxDown 引擎客户端（单连接 WS + 事件分发 + 指数退避重连）。
 *
 * 事件消费者经 `onDaemonEvent` 注册（EngineBridge 装配时挂上）；
 * 请求经 `call`（daemon.* / system.* 均可）。连接断开时在途请求全部按
 * unavailable 拒绝；重连成功后自动重新 hello + snapshot + selection 订阅。
 */
export class FluxDownClient {
  private readonly base: string;
  private readonly token: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private listeners = new Set<(e: FdDaemonEvent) => void>();
  private stateListeners = new Set<(ready: boolean) => void>();
  private connected = false;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 建连看门狗（12s 无握手强制重连；防容器启动竞态的零事件挂死） */
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  constructor(opts: FluxDownOptions) {
    this.base = (opts.baseUrl ?? "http://127.0.0.1:17800").replace(/\/+$/, "");
    this.token = opts.token;
  }

  /** 引擎 WS 根地址（http→ws） */
  private get wsUrl(): string {
    return this.base.replace(/^http/, "ws") + "/rpc";
  }

  onDaemonEvent(fn: (e: FdDaemonEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 连接状态变化（true = hello+snapshot 完成，可发请求） */
  onStateChange(fn: (ready: boolean) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  isReady(): boolean {
    return this.connected;
  }

  /** 启动连接（幂等）；服务退出（service-quit）后不再重连 */
  start(): void {
    if (this.ws !== null || this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.connectWatchdog) clearTimeout(this.connectWatchdog);
    this.connectWatchdog = null;
    this.teardown(new FluxDownUnavailableError("engine client stopped"));
    if (this.ws) this.ws.close(1000, "client-stop");
    this.ws = null;
  }

  private teardown(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    if (this.connected) {
      this.connected = false;
      for (const fn of this.stateListeners) fn(false);
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl, [
        "fluxdown.rpc.v1",
        "fluxdown.token." + b64url(this.token),
      ]);
    } catch (err: any) {
      this.scheduleRetry(err?.message ?? "connect failed");
      return;
    }
    this.ws = ws;
    // 建连看门狗：容器并行启动竞态实证（2026-10-09）——core 先于引擎就绪
    // 时的首连可能既不 onopen 也不 onerror/onclose（TCP 半开/引擎监听
    // 晚起），零事件 = 零重连 = 桥接永久挂死。12s 无握手直接强制重连。
    if (this.connectWatchdog) clearTimeout(this.connectWatchdog);
    this.connectWatchdog = setTimeout(() => {
      this.connectWatchdog = null;
      if (this.connected || ws !== this.ws) return;
      logger.warn("fluxdown connect stall (no handshake in 12s), retrying");
      this.ws = null;
      this.teardown(new FluxDownUnavailableError("connect stall"));
      try {
        ws.close(4001, "connect-stall");
      } catch {
        // 已死连接：close 抛错无害
      }
      this.scheduleRetry("connect stall watchdog");
    }, 12000);
    const clearWatchdog = () => {
      // 身份守卫：仅清当前连接自己的看门狗（旧连接的迟到回调不得
      // 误清重连后新连接的看门狗）
      if (this.connectWatchdog && ws === this.ws) {
        clearTimeout(this.connectWatchdog);
        this.connectWatchdog = null;
      }
    };
    ws.onopen = () => {
      if (ws !== this.ws) return;
      void this.handshake(ws)
        .then(() => {
          clearWatchdog();
        })
        .catch((err) => {
          logger.warn(`fluxdown handshake failed: ${err?.message ?? err}`);
          clearWatchdog();
          this.teardown(new FluxDownUnavailableError());
          this.scheduleRetry("handshake failed");
        });
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      if (typeof ev.data !== "string") return;
      this.onMessage(ev.data);
    };
    ws.onerror = () => {
      // 错误后必有 close，统一在 onclose 处理
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      clearWatchdog();
      this.ws = null;
      this.teardown(new FluxDownUnavailableError());
      if (this.stopped) return;
      if (ev.code === 4009) {
        // 事件缺口：立即重连重新 snapshot（不等退避）
        logger.warn("fluxdown event gap (4009), resyncing now");
        this.attempt = 0;
        this.connect();
        return;
      }
      this.scheduleRetry(`ws closed (${ev.code})`);
    };
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped || this.retryTimer) return;
    this.attempt += 1;
    // 1s 起步指数退避，上限 15s（引擎随 supervisord 自愈重启，core 常驻等待）
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempt - 1, 4));
    logger.warn(
      `fluxdown reconnect in ${delay}ms (attempt ${this.attempt}: ${reason})`,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** 握手：hello → snapshot（校验 daemon 投影）→ selection 订阅 */
  private async handshake(ws: WebSocket): Promise<void> {
    const hello = (await this.rawCall(ws, "system.hello", {
      clientName: "mei-portal-core",
      clientVersion: "1.0",
      minProtocolVersion: 1,
      maxProtocolVersion: 99,
      requestedRole: "agent",
      capabilities: ["client.selections"],
    }, 15000)) as { protocolVersion: number; serviceVersion: string };

    const snap = (await this.rawCall(ws, "system.snapshot", undefined, 15000)) as {
      body: { role: string; snapshot: { daemon: FdSnapshotDaemon } };
    };
    if (snap.body.role !== "agent" || !snap.body.snapshot?.daemon) {
      throw new Error("unexpected snapshot shape");
    }
    await this.rawCall(ws, "daemon.selection.subscribe", {}, 15000);

    this.attempt = 0;
    this.connected = true;
    for (const fn of this.stateListeners) fn(true);
    logger.info(
      `fluxdown engine connected (service ${hello.serviceVersion}, protocol v${hello.protocolVersion}, tasks ${snap.body.snapshot.daemon.tasks.length})`,
    );
    // 快照即现状：交给桥接层做全量对账
    for (const fn of this.listeners) fn({ type: "snapshot", data: snap.body.snapshot.daemon });
  }

  /** 在指定 socket 上发 JSON-RPC 请求（握手阶段用 rawCall；就绪后用 call） */
  private rawCall(
    ws: WebSocket,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new FluxDownError(`timeout: ${method}`, "timeout", true));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** 发请求（连接就绪后）；未就绪直接 unavailable */
  call<T = unknown>(method: string, params?: unknown, timeoutMs = 60000): Promise<T> {
    if (!this.connected || this.ws === null) {
      return Promise.reject(new FluxDownUnavailableError());
    }
    return this.rawCall(this.ws, method, params, timeoutMs) as Promise<T>;
  }

  private onMessage(text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        const data = msg.error.data ?? {};
        p.reject(
          new FluxDownError(
            `${msg.error.message ?? "rpc failed"}${data.code ? ` (${data.code})` : ""}`,
            String(data.code ?? "internal"),
            data.retryable === true,
          ),
        );
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === "service.event" && msg.params?.event) {
      // 实测 wire（server 0.5.4，adjacently-tagged 枚举）：
      //   params.event = {service:'agent', type:'daemon', event:<DaemonEvent>}
      //   DaemonEvent = {type:'taskChanged'|'engine'|..., data}
      // 兼容 HEAD 仓的嵌套形态（service + event:{type:'daemon', data}）。
      const svc = msg.params.event as {
        service?: string;
        type?: string;
        event?: unknown;
      };
      let d: unknown = null;
      if (svc.type === "daemon" && typeof svc.event === "object" && svc.event !== null) {
        d = svc.event; // v0.5.4：event 字段即 DaemonEvent
      } else if (
        (svc.event as { type?: string } | undefined)?.type === "daemon" &&
        typeof (svc.event as { data?: unknown }).data === "object"
      ) {
        // HEAD 嵌套形态：event:{type:'daemon', data:<DaemonEvent>}
        d = (svc.event as { data: unknown }).data;
      }
      if (d !== null && typeof (d as { type?: unknown }).type === "string") {
        for (const fn of this.listeners) {
          try {
            fn(d as FdDaemonEvent);
          } catch (err: any) {
            logger.warn(`fluxdown event handler error: ${err?.message ?? err}`);
          }
        }
      }
      return;
    }
    if (msg.method === "system.event" && msg.params) {
      // agent 直连 daemon 形态（非 server 模式才出现）：daemon 事件裸帧。
      // server 部署不会走这条，仅保持向前兼容。
      const d = msg.params as FdDaemonEvent;
      if (d && typeof d === "object" && "type" in d) {
        for (const fn of this.listeners) {
          try {
            fn(d);
          } catch (err: any) {
            logger.warn(`fluxdown event handler error: ${err?.message ?? err}`);
          }
        }
      }
    }
  }

  // ---- REST（探活/兜底；同 token 头鉴权）----

  async restPing(timeoutMs = 5000): Promise<{ version: string }> {
    const res = await fetch(`${this.base}/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => {
      throw new FluxDownUnavailableError();
    });
    if (!res.ok) throw new FluxDownError(`ping HTTP ${res.status}`);
    const body = (await res.json()) as { version?: string };
    return { version: body.version ?? "" };
  }

  async restGet<T>(apiPath: string, timeoutMs = 15000): Promise<T> {
    const res = await fetch(`${this.base}${apiPath}`, {
      headers: { "X-FluxDown-Token": this.token },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => {
      throw new FluxDownUnavailableError();
    });
    if (res.status === 401) throw new FluxDownError("token rejected", "unauthorized");
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 160);
      throw new FluxDownError(`HTTP ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
