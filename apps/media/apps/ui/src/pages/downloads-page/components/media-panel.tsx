// 下载中心·媒体面板 —— 复用 home-page 的下载任务列表（DownloadList）
// 数据源：media core /api/downloads?type=media（SSE 进度推送，无需轮询）。
// type=media：视频类任务（m3u8/bilibili/youtube/mediago），排除 direct（文件）
// 与 bt（磁力）——两者有独立 tab。
import { type FC } from "react";
import { DownloadFilter } from "@mediago/shared-common";
import { DownloadList } from "@/pages/home-page/components/download-list";

const MediaPanel: FC = () => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DownloadList filter={DownloadFilter.list} taskType="media" />
    </div>
  );
};

export default MediaPanel;
