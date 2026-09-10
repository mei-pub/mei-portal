// core/types —— Go internal/core/types.go 的复刻

export type DownloadType = 'm3u8' | 'bilibili' | 'direct' | 'mediago' | 'youtube';

export type TaskStatus = 'pending' | 'downloading' | 'success' | 'failed' | 'stopped';

/** 各下载类型对应的外部二进制名（不含扩展名；Windows 下调用方补 .exe） */
export const BinaryNames: Record<DownloadType, string> = {
  m3u8: 'N_m3u8DL-RE',
  bilibili: 'BBDown',
  direct: 'aria2c',
  mediago: 'mediago',
  youtube: 'yt-dlp',
};

export const FFmpegBinaryName = 'ffmpeg';

/** 下载任务参数（DB 任务用数字 ID 字符串，内存任务可用任意字符串） */
export interface DownloadParams {
  id: string;
  type: DownloadType;
  url: string;
  name: string;
  folder: string;
  headers: string[];
}

export interface ProgressEvent {
  id: string;
  type: 'ready' | 'progress';
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
}
