// 统一下载中心 —— 路由 /downloads?type=media|movie|music
// 三个面板统一风格（复用 DownloadTag / Progress / IconButton 视觉语言）：
//   media：媒体下载（复用 home-page 下载任务列表）
//   movie：影视服务器下载（/tv/api/local-sources，契约 1/2）
//   music：音乐下载库（/music/api/download/library，契约 3/4）
// query 定位：进入 ?type=movie 自动选中影视面板；切换面板时同步 query，
// 供其他应用经 /media/downloads?type=... 深链跳转。
import { Segmented } from "antd";
import { type FC, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageContainer from "@/components/page-container";
import MediaPanel from "./components/media-panel";
import MoviePanel from "./components/movie-panel";
import MusicPanel from "./components/music-panel";

export type DownloadCenterType = "media" | "movie" | "music";

const TYPE_OPTIONS: Array<{ label: string; value: DownloadCenterType }> = [
  { label: "媒体", value: "media" },
  { label: "影视", value: "movie" },
  { label: "音乐", value: "music" },
];

const parseType = (raw: string | null): DownloadCenterType => {
  return TYPE_OPTIONS.some((option) => option.value === raw)
    ? (raw as DownloadCenterType)
    : "media";
};

const DownloadsPage: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseType(searchParams.get("type"));

  const panel = useMemo(() => {
    switch (type) {
      case "movie":
        return <MoviePanel />;
      case "music":
        return <MusicPanel />;
      default:
        return <MediaPanel />;
    }
  }, [type]);

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
            媒体 / 影视 / 音乐 服务器下载统一管理
          </div>
        </div>
        <Segmented
          value={type}
          options={TYPE_OPTIONS}
          onChange={(value) => {
            const next = parseType(value as string);
            setSearchParams(next === "media" ? {} : { type: next });
          }}
        />
      </div>

      {/* 面板区：占满剩余高度并在面板内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
    </PageContainer>
  );
};

export default DownloadsPage;
