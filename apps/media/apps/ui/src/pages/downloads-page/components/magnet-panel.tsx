// 下载中心·磁力面板 —— BT 下载任务（media core type=bt）。
// 含磁力链接与 BT 种子文件两类来源，aria2c 执行。
import { type FC } from "react";
import { DownloadFilter } from "@mediago/shared-common";
import { DownloadList } from "@/pages/home-page/components/download-list";

const MagnetPanel: FC = () => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DownloadList filter={DownloadFilter.list} taskType="bt" />
    </div>
  );
};

export default MagnetPanel;
