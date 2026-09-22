// 下载中心「去播放」共享动作 —— 三种已完成条目的播放出口统一收口在此，
// 三 tab 与全部视图（embedded 复用三面板）零重复实现：
//   playMusicFile    音乐 tab（files 行）→ 外壳音乐引擎 play-now（不离开当前页）
//   playMovieRecord  影视 tab（done 集行）→ 有 playRoute 时深链走外壳承载路由
//   movieFallbackVideo / mediaVideoTarget → 就地播放目标（交给
//                    useInlinePlayer 弹层，关闭即回列表；不再跳独立播放器页）
// postMessage 的 parent 在门户部署下是外壳（同源），origin 用 window.location.origin。
import {
  type MediaPlayableVideo,
  type MovieSourceRecord,
  type MusicDownloadFile,
} from "@/api/download-center";
import type { InlineVideoTarget } from "@/pages/downloads-page/components/inline-player";

/** 运行在门户外壳 iframe 内（parent 是外壳，同源） */
export const isEmbeddedInShell = (): boolean =>
  window.parent !== window.self;

/** 媒体任务 → 可播视频匹配（/api/v1/videos 的 title 与任务 name 精确相等） */
export function matchMediaVideo(
  videos: MediaPlayableVideo[],
  taskName: string,
): MediaPlayableVideo | null {
  return videos.find((v) => v.title === taskName) ?? null;
}

/** 已匹配视频 → 就地播放目标（url 形如 /videos/N，免鉴权 Range 直播流） */
export function mediaVideoTarget(video: MediaPlayableVideo): InlineVideoTarget {
  return { title: video.title, url: video.url };
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

/** 影视 tab（有 playRoute 的记录）：深链走外壳承载路由跳 tv 播放页
 *  （本地源自动优先；独立模式整页跳转）。无 playRoute 的旧记录走
 *  movieFallbackVideo + 内嵌弹层，不要用本函数。 */
export function playMovieRecord(record: MovieSourceRecord): void {
  const route = record.playRoute || "";
  if (!route) return;
  if (isEmbeddedInShell()) {
    window.parent.postMessage(
      { source: "mei-iframe", type: "navigate", path: route },
      window.location.origin,
    );
  } else {
    window.location.assign(route);
  }
}

/** 影视 tab（无 playRoute 的旧记录）：从 localUrl（形如 /videos/1）提取
 *  就地播放目标；解析不出 id 返回 null（不渲染死按钮） */
export function movieFallbackVideo(record: MovieSourceRecord): InlineVideoTarget | null {
  const matched = /\/videos\/(\d+)/.exec(record.localUrl || "");
  if (!matched) return null;
  return { title: record.name || record.title || "已下载视频", url: record.localUrl };
}
