// 下载中心跨应用 API —— 契约（三方锁定）：
//   1. GET    /tv/api/local-sources/list       → { records: MovieSourceRecord[] }
//   2. DELETE /tv/api/local-sources?key=       → { removed: true }
//   3. GET    /music/api/download/library      → { tasks, files }
//   4. DELETE /music/api/download/library?path=→ { removed: true }
//   5. GET    /api/v1/videos                   → MediaPlayableVideo[]（裸 JSON，media core）
//
// 单镜像同源部署（UI 在 /downloads/ iframe 内），相对路径 fetch 自动携带门户
// mei-auth cookie；不经过 http axios 实例（那是 media core 专用，会注入 X-API-Key）。

export type MovieSourceStatus = "pending" | "downloading" | "done" | "failed";

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
  try {
    return (await resp.json()) as T;
  } catch {
    throw new Error("服务响应格式异常");
  }
}

/** 契约 1：影视本地资源列表 */
export function listMovieSources(): Promise<MovieSourceRecord[]> {
  return requestJson<{ records?: MovieSourceRecord[] }>(
    "/tv/api/local-sources/list",
  ).then((data) => data?.records ?? []);
}

/** 契约 2：删除影视本地资源（服务端顺带清落盘文件） */
export function deleteMovieSource(key: string): Promise<void> {
  return requestJson<{ removed?: boolean }>(
    `/tv/api/local-sources?key=${encodeURIComponent(key)}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

/** 契约 3：音乐下载库（tasks=进行中任务，files=磁盘已下载） */
export function getMusicLibrary(): Promise<MusicLibrary> {
  return requestJson<MusicLibrary>("/music/api/download/library");
}

/** 契约 4：删除音乐已下载文件（path 为相对 /downloads/music 的路径） */
export function deleteMusicFile(path: string): Promise<void> {
  return requestJson<{ removed?: boolean }>(
    `/music/api/download/library?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

/** 契约 5：media core 可播视频列表（已成功且文件在盘的任务，裸 JSON 数组） */
export function listMediaVideos(): Promise<MediaPlayableVideo[]> {
  return requestJson<MediaPlayableVideo[]>(getMediaVideosKey);
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
