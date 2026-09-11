// 媒体下载面板 —— 复用 home-page 的下载任务列表（DownloadList）
// 数据源：media core /api/downloads（SSE 进度推送，无需轮询）
import { type FC } from "react";
import { DownloadFilter } from "@mediago/shared-common";
import { DownloadList } from "@/pages/home-page/components/download-list";

const MediaPanel: FC = () => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DownloadList filter={DownloadFilter.list} />
    </div>
  );
};

export default MediaPanel;
