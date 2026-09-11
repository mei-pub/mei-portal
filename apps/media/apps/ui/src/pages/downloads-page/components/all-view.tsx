// 全部视图 —— 三段聚合（媒体 / 影视 / 音乐各一段），每段复用对应面板的
// embedded 模式：数据获取、排序、轮询全部留在面板内部（影视/音乐经 shared-poll
// 共享页面级**单一** 3s 计时器，且仅在存在进行中任务时运行；媒体走 SSE 无轮询），
// 全部视图不复制任何列表逻辑，只负责纵向编排与整体滚动。
import { type FC } from "react";
import MediaPanel from "./media-panel";
import MoviePanel from "./movie-panel";
import MusicPanel from "./music-panel";

interface AllViewProps {
  /** 段头「进入 →」：锚定对应 tab（由 index 统一切换并同步 query） */
  onEnter: (tab: "media" | "movie" | "music") => void;
}

const AllView: FC<AllViewProps> = ({ onEnter }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
    <MediaPanel embedded onEnter={() => onEnter("media")} />
    <MoviePanel embedded onEnter={() => onEnter("movie")} />
    <MusicPanel embedded onEnter={() => onEnter("music")} />
  </div>
);

export default AllView;
