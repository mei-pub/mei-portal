// 下载中心「去播放」共享动作 —— 三种已完成条目的播放出口统一收口在此，
// 三 tab 与全部视图（embedded 复用三面板）零重复实现：
//   playMusicFile    音乐 tab（files 行）→ 外壳音乐引擎 play-now（不离开当前页）
//   playMovieRecord  影视 tab（done 集行）→ playRoute 深链走外壳承载路由；
//                    旧记录无 playRoute 时降级 media 自带播放器页
//   playMediaTask    媒体 tab（done 任务）→ /api/v1/videos 按 title 匹配后
//                    新开 media 播放器页（配合 SWR 缓存用 openMediaVideo 免二次请求）
// postMessage 的 parent 在门户部署下是外壳（同源），origin 用 window.location.origin。
import {
  listMediaVideos,
  type MediaPlayableVideo,
  type MovieSourceRecord,
  type MusicDownloadFile,
} from "@/api/download-center";

/** 运行在门户外壳 iframe 内（parent 是外壳，同源） */
export const isEmbeddedInShell = (): boolean =>
  window.parent !== window.self;

/** media 子路径前缀：门户内为 /media，独立部署为根路径（与 main.tsx basename 判定一致） */
export const mediaRouteBase = (): string =>
  window.location.pathname.startsWith("/media") ? "/media" : "";

/** media 自带播放器页（video.js，门户内经 nginx /media/player 直通） */
export const mediaPlayerUrl = (id: number): string =>
  `${mediaRouteBase()}/player?id=${id}`;

/** 媒体任务 → 可播视频匹配（/api/v1/videos 的 title 与任务 name 精确相等） */
export function matchMediaVideo(
  videos: MediaPlayableVideo[],
  taskName: string,
): MediaPlayableVideo | null {
  return videos.find((v) => v.title === taskName) ?? null;
}

/** 音乐 tab：播放已下载文件 —— 外壳引擎立即播放并常驻（MusicDock 出现） */
export function playMusicFile(file: MusicDownloadFile): void {
  const song = {
    id: `file:${file.path}`,
    name: file.name || file.fileName,
    artist: file.artist || "",
    source: "server-local",
  };
  if (isEmbeddedInShell()) {
    window.parent.postMessage(
      { source: "mei-music-guest", type: "play-now", song },
      window.location.origin,
    );
  } else {
    // 独立部署：无外壳引擎可转发，跳音乐应用根由其自身接管
    window.location.assign("/music");
  }
}

/** 影视 tab：播放已完成的集 —— 新记录走 playRoute 深链（外壳承载路由跳 tv
 *  播放页，本地源自动优先；独立模式整页跳转），旧记录无 playRoute 时从
 *  localUrl（形如 /videos/1）提取数字 id 直开 media 播放器页 */
export function playMovieRecord(record: MovieSourceRecord): void {
  const route = record.playRoute || "";
  if (route) {
    if (isEmbeddedInShell()) {
      window.parent.postMessage(
        { source: "mei-iframe", type: "navigate", path: route },
        window.location.origin,
      );
    } else {
      window.location.assign(route);
    }
    return;
  }
  const matched = /\/videos\/(\d+)/.exec(record.localUrl || "");
  if (matched) {
    window.open(mediaPlayerUrl(Number(matched[1])), "_blank");
  }
}

/** 媒体 tab：播放已完成任务 —— 拉 /api/v1/videos 按 title 匹配后新开播放器页。
 *  返回是否成功（列表不可达或未匹配到视频时为 false，调用方可 toast 引导）。 */
export async function playMediaTask(task: {
  name: string;
}): Promise<boolean> {
  try {
    const videos = await listMediaVideos();
    const video = matchMediaVideo(videos, task.name);
    if (!video) return false;
    window.open(mediaPlayerUrl(video.id), "_blank");
    return true;
  } catch {
    return false;
  }
}

/** 打开已匹配到的可播视频（配合 /api/v1/videos 的 SWR 缓存，命中后免二次请求） */
export function openMediaVideo(video: MediaPlayableVideo): void {
  window.open(mediaPlayerUrl(video.id), "_blank");
}
