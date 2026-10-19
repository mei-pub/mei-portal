// core/types —— Go internal/core/types.go 的复刻

export type DownloadType =
  | "m3u8"
  | "bilibili"
  | "direct"
  | "mediago"
  | "youtube"
  | "bt";

export type TaskStatus =
  | "pending"
  | "downloading"
  | "success"
  | "failed"
  | "stopped";

/**
 * 队列执行类型对应的外部二进制名（不含扩展名；Windows 下调用方补 .exe）。
 * direct/bt 不在表内——它们由 FluxDown 引擎执行（service/engine 桥接），
 * 不再 spawn 本地二进制（aria2 已随引擎统一退役）。
 */
export const BinaryNames: Record<string, string> = {
  m3u8: "N_m3u8DL-RE",
  bilibili: "BBDown",
  mediago: "mediago",
  youtube: "yt-dlp",
};

export const FFmpegBinaryName = "ffmpeg";

/** 下载任务参数（DB 任务用数字 ID 字符串，内存任务可用任意字符串） */
export interface DownloadParams {
  id: string;
  type: DownloadType;
  url: string;
  name: string;
  folder: string;
  headers: string[];
  /** BT 种子文件任务的下载文件索引（"1,3-5"；空/缺省 = 全部） */
  selectFile?: string;
}

export interface ProgressEvent {
  id: string;
  type: "ready" | "progress";
  percent: number;
  speed: string;
  isLive: boolean;
}

export interface MessageEvent {
  id: string;
  message: string;
}

export interface TaskInfo {
  id: string;
  type: DownloadType;
  url: string;
  name: string;
  status: TaskStatus;
  percent: number;
  speed: string;
  isLive: boolean;
  error?: string;
  /** 引擎（FluxDown）任务的实时数据：上传/做种/字节等，列表与详情 UI 消费 */
  engine?: EngineTaskExtras;
}

/** 引擎任务附加实时数据（/api/tasks 附加字段；由桥接层从引擎事件派生） */
export interface EngineTaskExtras {
  /** 引擎任务 ID */
  taskId: string;
  /** 上传速度（展示串，如 "1.2MiB/s"） */
  uploadSpeed: string;
  /** 累计上传字节（BT 做种） */
  uploadedBytes: number;
  downloadedBytes: number;
  totalBytes: number;
  /** 做种状态（0 无 / 1 做种中 / 2-7 停止原因 / 8 排队做种） */
  seeding: number;
  seedingMessage: string;
  /** 累计做种秒数 */
  seedingTimeSecs: number;
}

export interface Callbacks {
  onProgress?: (e: ProgressEvent) => void;
  onMessage?: (m: MessageEvent) => void;
}

/** 运行时配置访问（Downloader 依赖的最小面，对应 Go 的 interface{ GetXxx() } 断言） */
export interface DownloaderConfig {
  getLocalDir(): string;
  getDeleteSegments(): boolean;
  getProxy(): string;
  getUseProxy(): boolean;
  /** 配置目录（torrents 缓存：磁力网关种子 / 上传种子文件所在根） */
  getConfigDir?(): string;
}

