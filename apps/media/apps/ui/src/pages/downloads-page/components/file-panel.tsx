// 下载中心·文件面板 —— 普通文件下载任务（media core type=direct）。
// 直链文件（http/ftp/file），与视频类、磁力分开成 tab。
import { type FC } from "react";
import { DownloadFilter } from "@mediago/shared-common";
import { DownloadList } from "@/pages/home-page/components/download-list";

const FilePanel: FC = () => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DownloadList filter={DownloadFilter.list} taskType="direct" />
    </div>
  );
};

export default FilePanel;
