// 下载中心 —— 应用根路由 /（默认全部）或 /?type=media|movie|music
// （应用部署在 /downloads 子路径下，下载中心即应用首页）
// 四个 tab：全部 / 媒体 / 影视 / 音乐；「全部」聚合三段（各段带段头与「进入 →」，
// 实现在 components/all-view.tsx）。三个单类型面板统一风格（复用 DownloadTag /
// Progress / IconButton 视觉语言）：
//   media：媒体任务（复用 home-page 下载任务列表）
//   movie：影视服务器下载（/tv/api/local-sources，契约 1/2）
//   music：音乐下载库（/music/api/download/library，契约 3/4）
// URL 规范：默认 tab（全部）清空 query——应用根是无 query 的规范地址；
// `?type=all` 也接受并归一为全部。深链契约保持不变：影视/音乐应用经
// ?type=movie|music 直达对应面板。
import { Segmented } from "antd";
import { type FC, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageContainer from "@/components/page-container";
import AllView from "./components/all-view";
import MediaPanel from "./components/media-panel";
import MoviePanel from "./components/movie-panel";
import MusicPanel from "./components/music-panel";

export type DownloadCenterTab = "all" | "media" | "movie" | "music";

const TYPE_OPTIONS: Array<{ label: string; value: DownloadCenterTab }> = [
  { label: "全部", value: "all" },
  { label: "媒体", value: "media" },
  { label: "影视", value: "movie" },
  { label: "音乐", value: "music" },
];

// 无 query / type=all / 无效值 → 全部（默认 tab）；media|movie|music 深链保持原语义
const parseType = (raw: string | null): DownloadCenterTab => {
  return raw === "media" || raw === "movie" || raw === "music" ? raw : "all";
};

const DownloadsPage: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseType(searchParams.get("type"));

  // 切 tab / 段头「进入 →」统一出口：全部 → 清空 query（规范 URL），
  // 其余 → ?type=<tab>，浏览器前进后退与深链分享都可用
  const goTo = useCallback(
    (next: DownloadCenterTab) => {
      setSearchParams(next === "all" ? {} : { type: next });
    },
    [setSearchParams],
  );

  const panel = useMemo(() => {
    switch (type) {
      case "media":
        return <MediaPanel />;
      case "movie":
        return <MoviePanel />;
      case "music":
        return <MusicPanel />;
      default:
        return <AllView onEnter={goTo} />;
    }
  }, [type, goTo]);

  return (
      <PageContainer className="bg-white/85 dark:bg-[#1F2024] flex flex-col flex-1 min-h-0 h-full rounded-xl border border-black/5 shadow-sm p-3 gap-3 overflow-hidden">
        {/* 应用信息横幅（对齐 home-page Hero） */}
        <div className="flex shrink-0 items-center gap-3 px-1 pt-1">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-[0_6px_20px_rgba(99,102,241,0.4)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-[22px] font-extrabold leading-tight tracking-tight text-transparent">
              下载中心
            </div>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              全部 / 媒体 / 影视 / 音乐 服务器下载统一管理
            </div>
          </div>
          <Segmented
            value={type}
            options={TYPE_OPTIONS}
            onChange={(value) => {
              goTo(parseType(value as string));
            }}
          />
        </div>

        {/* 面板区：占满剩余高度并在面板内部滚动 */}
        <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
      </PageContainer>
  );
};

export default DownloadsPage;
