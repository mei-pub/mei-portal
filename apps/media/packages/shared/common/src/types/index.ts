import type { Conversion, Favorite, Video } from "./entities";

export type Controller = Record<string | symbol, any>;

export interface DownloadTask {
  id: number;
  type: DownloadType;
  name: string;
  url: string;
  headers?: string;
  status?: DownloadStatus;
  folder?: string;
  isLive?: boolean;
  /** BT 种子文件任务的下载文件索引（"1,3"；缺省=全部） */
  selectFile?: string;
  createdDate?: Date;
  /** 引擎任务关联（FluxDown；direct/bt 行携带——详情抽屉入口判定） */
  engineTaskId?: string | null;
  /** 直链任务分段数（FluxDown 动态分段；0/null = 按大小自动推荐） */
  segments?: number | null;
  /** 归属命名队列（FluxDown daemon.queue；null = 引擎默认 Main Queue） */
  queueId?: string | null;
}

export enum DownloadFilter {
  /** 进行中（status != success）——媒体/文件面板用（完成品有专门的管理页） */
  list = "list",
  /** 仅已完成 */
  done = "done",
  /** 全部状态——磁力面板用：磁力任务没有独立已下载页，完成品留在本列表 */
  all = "",
}

export interface DownloadTaskPagination {
  current?: number;
  pageSize?: number;
  filter?: DownloadFilter;
  /** 任务类型过滤：direct=文件 / bt=磁力 / media=视频类（排除 direct、bt） */
  type?: string;
}

export interface ConversionPagination {
  current?: number;
  pageSize?: number;
}

export interface DownloadTaskResponse {
  total: number;
  list: DownloadTaskWithFile[];
}

export interface ConversionResponse {
  total: number;
  list: Conversion[];
}

export enum DownloadStatus {
  Ready = "ready",
  Pending = "pending",
  Downloading = "downloading",
  Stopped = "stopped",
  Success = "success",
  Failed = "failed",
}

export type Task = {
  id: number;
  params: Omit<DownloadParams, "id" | "abortSignal" | "callback">;
};

export interface DownloadProgress {
  id: number;
  type: string;
  percent: string;
  speed: string;
  isLive: boolean;
  status: DownloadStatus;
  /** 引擎任务（FluxDown）附加：BT 上传速率（下载回馈 swarm / 完成后做种） */
  uploadSpeed?: string;
  /** 引擎任务附加：做种状态（FluxDown seedingStatus：1=做种中） */
  seeding?: number;
  /** 引擎任务附加：已连接节点数 */
  peers?: number | null;
}

export enum DownloadType {
  m3u8 = "m3u8",
  bilibili = "bilibili",
  direct = "direct",
  mediago = "mediago",
  youtube = "youtube",
  bt = "bt",
}

export interface DownloadParams {
  id: number;
  type: DownloadType;
  url: string;
  local: string;
  name: string;
  headers?: string;
  abortSignal: AbortController;
  proxy?: string;
  deleteSegments?: boolean;
  callback: (type: string, data: any) => void;
  folder?: string;
}

export interface DownloadTaskWithFile extends DownloadTask {
  exists?: boolean;
  file?: string;
  /** 引擎任务（FluxDown，direct/bt）实时态：做种/上传/节点数（任务列表
   *  行携带；下载中数据也经 /api/tasks 轮询事件通道更新） */
  engine?: DownloadEngineInfo;
}

/** 引擎任务实时信息（列表行 / 详情抽屉共用字段子集） */
export interface DownloadEngineInfo {
  /** BT 上传速率（已格式化，如 "1.5MiB/s"） */
  uploadSpeed: string;
  /** 累计上传字节 */
  uploadedBytes: number;
  /** 做种状态（FluxDown seedingStatus：0=无 1=做种中 2-8=停止原因） */
  seeding: number;
  /** 做种状态别名（同 seeding；保留字段名兼容引擎事件口径） */
  seedingStatus: number;
  /** 做种说明（停止原因的人类可读文案） */
  seedingMessage: string;
  /** 累计做种秒数 */
  seedingTimeSecs: number;
  /** 已连接 peer 数（BT；null=未知） */
  peers: number | null;
  /** 活跃传输数（分段/连接；null=未知） */
  activeTransfers: number | null;
  /** 已下载字节 */
  downloadedBytes: number;
  /** 总字节 */
  totalBytes: number;
}

export interface ListPagination {
  total: number;
  list: DownloadTaskWithFile[];
}

export enum AppTheme {
  System = "system",
  Light = "light",
  Dark = "dark",
}

export enum AppLanguage {
  System = "system",
  ZH = "zh",
  EN = "en",
}

export interface DownloadContext {
  // Whether it is live
  isLive: boolean;
  // Download progress
  percent: string;
  // Download speed
  speed: string;
  // Ready
  ready: boolean;
}

export interface ExecOptions {
  binPath: string;
  args: string[];
  abortSignal: AbortController;
  encoding?: string;
  onMessage?: (ctx: DownloadContext, message: string) => void;
}

/**
 * Platform
 */
export enum Platform {
  Windows = "win32",
  MacOS = "darwin",
  Linux = "linux",
}

export interface DownloadEvent<T = any> {
  type: string;
  data: T;
}

export interface DownloadSuccessEvent extends DownloadEvent<DownloadTask> {
  type: "success";
}

export interface DownloadFailedData {
  id: number;
  error: string;
}

export interface DownloadFailedEvent extends DownloadEvent<DownloadFailedData> {
  type: "failed";
}

export interface DownloadStoppedEvent extends DownloadEvent<{ id: number }> {
  type: "stopped";
}

export interface DownloadProgressEvent extends DownloadEvent<
  DownloadProgress[]
> {
  type: "progress";
}

/**
 * Emitted when new tasks are created — e.g. the browser extension POSTs
 * to /api/downloads, or any external client hits Go Core directly.
 * Carries the newly-created task IDs so listeners can cheaply decide
 * whether they need to refetch.
 */
export interface DownloadCreatedEvent extends DownloadEvent<{
  ids: number[];
  count: number;
}> {
  type: "created";
}

export interface EnvPath {
  binPath: string;
  dbPath: string;
  workspace: string;
  platform: string;
  local: string;
  playerUrl: string;
  coreUrl: string;
}

export interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface AppStore {
  // Local storage address
  local: string;
  // Download completion tone
  promptTone: boolean;
  // Proxy address
  proxy: string;
  // Whether to enable agent
  useProxy: boolean;
  // Delete the original file after downloading
  deleteSegments: boolean;
  // A new window opens the browser
  openInNewWindow: boolean;
  mainBounds?: Rectangle;
  browserBounds?: Rectangle;
  blockAds: boolean;
  // theme
  theme: AppTheme;
  // Using browser plugins
  useExtension: boolean;
  // Whether to use mobile UA
  isMobile: boolean;
  // Maximum number of simultaneous downloads
  maxRunner: number;
  // Language
  language: AppLanguage;
  // Show terminal or not
  showTerminal: boolean;
  // Privacy mode
  privacy: boolean;
  // Machine id
  machineId: string;
  // Download proxy Settings
  downloadProxySwitch: boolean;
  // Automatic update
  autoUpgrade: boolean;
  // beta versions are allowed
  allowBeta: boolean;
  // Close the main window
  closeMainWindow: boolean;
  // Whether to play sounds in the browser. The default value is mute
  audioMuted: boolean;
  // Whether to enable Docker
  enableDocker: boolean;
  // Docker URL
  dockerUrl: string;
  // Mobile player
  enableMobilePlayer: boolean;
  // server apikey
  apiKey: string;

}

export interface WebSource {
  url: string;
  type: DownloadType;
  name: string;
  headers?: string;
}

export interface BrowserStore {
  url: string;
  sourceList: WebSource[];
}

export interface SetupAuthRequest {
  apiKey: string;
}

export interface IS_SETUP_RESPONSE {
  setuped: boolean;
}

/**
 * Data/CRUD operations — routed to Go Core HTTP API.
 * Available in both Electron and web/server modes.
 */
export interface GoApi {
  getEnvPath(): Promise<EnvPath>;
  getFavorites(): Promise<Favorite[]>;
  addFavorite(
    favorite: Omit<Favorite, "id" | "createdDate" | "updatedDate">,
  ): Promise<Favorite>;
  removeFavorite(id: number): Promise<void>;
  getAppStore(): Promise<AppStore>;
  setAppStore(
    key: keyof AppStore,
    val: AppStore[keyof AppStore],
  ): Promise<void>;
  createDownloadTasks(
    tasks: Omit<DownloadTask, "id">[],
    startDownload?: boolean,
  ): Promise<Video[]>;
  getDownloadTasks(p: DownloadTaskPagination): Promise<DownloadTaskResponse>;
  startDownload(vid: number): Promise<void>;
  stopDownload(id: number): Promise<void>;
  deleteDownloadTask(id: number): Promise<void>;
  updateDownloadTask(
    task: DownloadTask,
    startDownload?: boolean,
  ): Promise<void>;
  getVideoFolders(): Promise<string[]>;
  getDownloadLog(id: number): Promise<string>;
  getConversions(pagination: ConversionPagination): Promise<ConversionResponse>;
  addConversion(conversion: {
    name: string;
    path: string;
    outputFormat: string;
    quality: string;
  }): Promise<Conversion>;
  deleteConversion(id: number): Promise<void>;
  startConversion(id: number): Promise<void>;
  stopConversion(id: number): Promise<void>;
  getPageTitle(url: string): Promise<string | undefined>;
  setupAuth(req: SetupAuthRequest): Promise<void>;
  signin(req: SetupAuthRequest): Promise<void>;
  isSetup(): Promise<IS_SETUP_RESPONSE>;
  openUrl(url: string): Promise<void>;
}

// ============================================================
// Generic dialog / shell / contextMenu types
// ============================================================

export interface DialogOpenOptions {
  type: "file" | "directory";
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  /** If true, returns file contents instead of paths (only for type: 'file') */
  readContent?: boolean;
}

export interface DialogSaveOptions {
  content: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface ContextMenuItem {
  key: string;
  label: string;
  type?: "separator";
}

// ============================================================
// PlatformApi — namespaced, routed to Electron IPC in desktop
// mode, no-op stubs in web/server mode.
// ============================================================

export interface PlatformApi {
  browser: {
    loadURL(url: string): Promise<void>;
    back(): Promise<boolean>;
    reload(): Promise<void>;
    show(): Promise<void>;
    hide(): Promise<void>;
    home(): Promise<void>;
    setBounds(rect: Rectangle): Promise<void>;
    setUserAgent(isMobile: boolean): Promise<void>;
    clearCache(): Promise<void>;
    pluginReady(): Promise<void>;
    showDownloadDialog(data: Omit<DownloadTask, "id">[]): Promise<void>;
    dismissOverlayDialog(): Promise<void>;
  };
  app: {
    getEnvPath(): Promise<EnvPath>;
    /**
     * Absolute path to the bundled browser-extension directory.
     * Electron-only (web/server stub returns an empty string). Paired
     * with `shell.open()` to surface the folder in the OS file manager
     * from the Settings page.
     */
    getExtensionDir(): Promise<string>;
    getSharedState(): Promise<unknown>;
    setSharedState(state: unknown): Promise<void>;
    showBrowserWindow(): Promise<void>;
    combineToHomePage(store: BrowserStore): Promise<void>;
  };
  dialog: {
    open(options: DialogOpenOptions): Promise<string[]>;
    save(options: DialogSaveOptions): Promise<string>;
  };
  shell: {
    open(target: string): Promise<void>;
  };
  contextMenu: {
    show(items: ContextMenuItem[]): Promise<string | null>;
  };
  update: {
    check(): Promise<void>;
    startDownload(): Promise<void>;
    install(): Promise<void>;
  };
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

/** Combined API — backward compatible union of Go + Platform */
export type MediaGoApi = GoApi & PlatformApi;
