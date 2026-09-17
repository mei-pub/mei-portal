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

/** 各下载类型对应的外部二进制名（不含扩展名；Windows 下调用方补 .exe） */
export const BinaryNames: Record<DownloadType, string> = {
  m3u8: "N_m3u8DL-RE",
  bilibili: "BBDown",
  direct: "aria2c",
  mediago: "mediago",
  youtube: "yt-dlp",
  // 磁力（BT）复用 aria2c（DHT 发现 peer；seed-time=0 下载完成即退出）
  bt: "aria2c",
};

export const FFmpegBinaryName = "ffmpeg";

/** aria2 下载引擎设置（下载中心设置页「下载引擎」tab，direct/bt 共用）
 *  —— 与 apps/ui 侧 shared/common types 的 Aria2Options 结构对齐（双侧平行定义） */
export interface Aria2BtOptions {
  /** DHT 网络（磁力找 peer 的主要途径；关闭后纯靠 tracker） */
  enableDht: boolean;
  /** 本地对等发现（LPD，局域网组播） */
  enableLpd: boolean;
  /** Peer 交换（PEX） */
  enablePex: boolean;
  /** BT 监听端口（形如 6881-6999 或 6881；空 = aria2 默认 6881-6999，TCP/UDP 同源） */
  listenPort: string;
  /** 上传限速（如 2M；空 = 不限） */
  uploadLimit: string;
  /** 最大 Peer 连接数 */
  maxPeers: number;
  /** 补充 tracker 列表（逗号/换行分隔；拼 --bt-tracker，磁力自带 tr 之外的全局注入） */
  trackers: string;
}

export interface Aria2Options {
  /** 单服务器并发连接数（--max-connection-per-server，aria2 上限 16） */
  connections: number;
  /** 分下载数（--split） */
  splits: number;
  /** 最小分片大小（--min-split-size，如 1M / 512K） */
  minSplitSize: string;
  /** 全局下载限速（--max-overall-download-limit，如 10M；空 = 不限） */
  speedLimit: string;
  /** 重试次数（--max-tries） */
  maxTries: number;
  /** 重试间隔秒（--retry-wait） */
  retryWait: number;
  bt: Aria2BtOptions;
}

/** 下载任务参数（DB 任务用数字 ID 字符串，内存任务可用任意字符串） */
export interface DownloadParams {
  id: string;
  type: DownloadType;
  url: string;
  name: string;
  folder: string;
  headers: string[];
  /** BT 种子文件任务的下载文件索引（--select-file，如 "1,3-5"；空/缺省 = 全部） */
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
  /** aria2 引擎设置（direct/bt；热更新经闭包读最新值） */
  getAria2Options(): Aria2Options;
  /** DHT 路由表持久化文件（IPv4；空 = 不持久化）。aria2 启动加载 / 正常退出
   *  保存 —— 磁力解析与 BT 下载跨进程复用路由表，冷启动从 ~30s 降到秒级 */
  getDhtFile?(): string;
  /** 配置目录（torrents 缓存 / 解析暂存所在根；缺省 /data/media） */
  getConfigDir?(): string;
  /** aria2 RPC 对外引擎设置（端口/secret 可配，第三方客户端接入控制） */
  getAria2Rpc(): Aria2RpcOptions;
}

/** aria2 RPC 对外引擎设置（conf.aria2Rpc；与 apps/ui 侧 shared/common 平行定义） */
export interface Aria2RpcOptions {
  /** 是否启用对外 RPC 守护 */
  enabled: boolean;
  /** RPC 监听端口（容器内；compose 映射到宿主） */
  port: number;
  /** RPC secret（第三方客户端接入凭证） */
  secret: string;
}

