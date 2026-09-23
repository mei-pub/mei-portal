// 下载中心跨应用 API —— 契约（三方锁定）：
//   1. GET    /tv/api/local-sources/list       → { records: MovieSourceRecord[] }
//   2. DELETE /tv/api/local-sources?key=       → { removed: true }
//   3. GET    /music/api/download/library      → { tasks, files }
//   4. DELETE /music/api/download/library?path=→ { removed: true }
//   5. GET    /api/v1/videos                   → MediaPlayableVideo[]（裸 JSON，media core）
//   6. PUT    /tv/api/local-sources            → { updated: true }（修改信息，同步改名 media 任务）
//
// 单镜像同源部署（UI 在 /downloads/ iframe 内），相对路径 fetch 自动携带门户
// mei-auth cookie；/tv、/music 契约口不经过 http axios 实例（那是 media core
// 专用，会注入 X-API-Key）。
// media core 自身的端点（删除任务 / 可播视频列表）走 http 实例：electron 桌面
// 模式其 baseURL 指向本地 core 且需要 X-API-Key，裸 fetch 相对路径必失败；
// web 模式 baseURL = 同源 origin，行为不变。
import { http } from "@/utils";

export type MovieSourceStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "done"
  | "failed";

export interface MovieSourceRecord {
  key: string;
  title: string;
  year: string | number;
  episode: string | number;
  totalEpisodes: string | number;
  category: string;
  name: string;
  mediaTaskId: string | number;
  status: MovieSourceStatus;
  localUrl: string;
  progress: number | null;
  speed: string | null;
  createdAt: string;
  updatedAt: string;
  /** done 记录的播放页深链（如 /play/liangzi/48245?source=xx）；旧记录缺省为 null */
  playRoute?: string | null;
}

export interface MusicDownloadTask {
  id: string | number;
  song: { name: string; artist: string; source: string };
  status: string;
  percent: number;
  speed: string;
  path: string;
  error: string;
}

export interface MusicDownloadFile {
  artist: string;
  name: string;
  fileName: string;
  path: string;
  size: number;
  mtime: string | number;
}

export interface MusicLibrary {
  tasks: MusicDownloadTask[];
  files: MusicDownloadFile[];
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch {
    throw new Error("网络请求失败");
  }
  if (!resp.ok) {
    throw new Error(`服务响应异常（HTTP ${resp.status}）`);
  }
  // 先以 resp.ok 判定成功；204 / 空 body / 非 JSON body 不再误判为失败
  // （DELETE 契约口可能不带响应体），统一按成功处理返回 undefined
  const text = await resp.text().catch(() => "");
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

/** 契约 1：影视本地资源列表 */
export function listMovieSources(): Promise<MovieSourceRecord[]> {
  return requestJson<{ records?: MovieSourceRecord[] }>(
    "/tv/api/local-sources/list",
  ).then((data) => data?.records ?? []);
}

/** 契约 2：删除影视本地资源；files=false 仅删记录保留落盘文件（已完成
 * 记录的二选一）；未完成/失败记录服务端总是级联停 media 任务并清临时文件 */
export function deleteMovieSource(key: string, files = true): Promise<void> {
  return requestJson<{ removed?: boolean }>(
    `/tv/api/local-sources?key=${encodeURIComponent(key)}&files=${files ? "1" : "0"}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

/** 契约 3：音乐下载库（tasks=进行中任务，files=磁盘已下载） */
export function getMusicLibrary(): Promise<MusicLibrary> {
  return requestJson<MusicLibrary>("/music/api/download/library");
}

/** 契约 4a：删除音乐进行中任务（服务端中断下载流并清理 .part 临时文件） */
export function deleteMusicTask(id: string | number): Promise<void> {
  return requestJson<{ removed?: boolean }>(
    `/music/api/download/server?id=${encodeURIComponent(String(id))}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

/** 契约 4b：删除音乐已下载文件（path 为相对 /downloads/music 的路径） */
export function deleteMusicFile(path: string): Promise<void> {
  return requestJson<{ removed?: boolean }>(
    `/music/api/download/library?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

/** 契约 6：修改信息——重命名影视记录显示名；服务端同步改名 media 下载任务 */
export function renameMovieSource(key: string, name: string): Promise<void> {
  return requestJson<{ updated?: boolean }>("/tv/api/local-sources", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, name }),
  }).then(() => undefined);
}

/** 影视记录的原始下载链接（media 任务 url，按需获取——列表不随行携带，
 *  「复制链接」点击时才拉一次）。走 http 实例（electron 桌面 baseURL） */
export function getMediaTaskUrl(id: number | string): Promise<string | null> {
  return http
    .get<{ url?: string } | { data?: { url?: string } }>(
      `/api/downloads/${id}`,
    )
    .then((data: any) => {
      const url = data?.url ?? data?.data?.url;
      return typeof url === "string" && url ? url : null;
    })
    .catch(() => null);
}

/** 删除 media 下载任务：停止下载；deleteFiles=true 连落盘产物一起清理
 *  （未完成任务的分片临时 / 已完成任务的成品文件）。
 *  走 http 实例（electron 桌面 baseURL + X-API-Key），见文件头说明 */
export function deleteMediaTask(id: number, deleteFiles = false): Promise<void> {
  return http
    .delete(`/api/downloads/${id}`, {
      params: { deleteFiles: deleteFiles ? 1 : 0 },
    })
    .then(() => undefined);
}

/** 契约 5：media core 可播视频列表（已成功且文件在盘的任务，裸 JSON 数组） */
export function listMediaVideos(): Promise<MediaPlayableVideo[]> {
  return http.get(getMediaVideosKey).then((data: unknown) =>
    Array.isArray(data) ? (data as MediaPlayableVideo[]) : [],
  );
}

/** 应用内附件直链：门户部署挂在 /downloads 前缀（与 main.tsx 的
 *  routerBasename 同规则），独立部署/桌面在根路径。相对路径 files/:id 在
 *  /downloads 无尾斜杠时会被解析到站点根（/files/:id 404），必须用本函数 */
export function appFileUrl(path: string): string {
  const prefix = window.location.pathname.startsWith("/downloads")
    ? "/downloads/"
    : "/";
  return `${prefix}${path.replace(/^\/+/, "")}`;
}

/** media core /api/v1/videos 的 SWR 缓存 key（可播视频列表共享缓存） */
export const getMediaVideosKey = "/api/v1/videos";

/** media core /api/v1/videos 条目：title = 下载任务 name（匹配键） */
export interface MediaPlayableVideo {
  id: number;
  title: string;
  url: string;
  mimeType: string;
}

/** 字节数格式化（音乐文件大小展示） */
export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
