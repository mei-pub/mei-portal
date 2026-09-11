// 下载中心·媒体面板 —— 复用 home-page 的下载任务列表（DownloadList）
// 数据源：media core /api/downloads（SSE 进度推送，无需轮询）。
// embedded=true（全部视图）：自带段头（计数徽标 + 「进入 →」），进行中任务置前。
import { type FC } from "react";
import { DownloadFilter, DownloadStatus } from "@mediago/shared-common";
import { useTasks } from "@/hooks/use-tasks";
import { DownloadList } from "@/pages/home-page/components/download-list";
import { SectionHeader } from "./section-header";

interface Props {
  /** 全部视图内嵌模式：段卡片 + 段头，进行中置前 */
  embedded?: boolean;
  /** 段头「进入 →」回调（锚定媒体 tab） */
  onEnter?: () => void;
}

const MediaPanel: FC<Props> = ({ embedded = false, onEnter }) => {
  // 与 DownloadList 内部同一个 SWR key（filter/page/pageSize 相同），只取段头
  // 计数，共享缓存，不会产生第二次请求；进度更新由 SSE 事件驱动缓存失效。
  const { data, total } = useTasks(DownloadFilter.list);
  const activeCount = data.filter(
    (task) => task.status === DownloadStatus.Downloading,
  ).length;

  if (!embedded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DownloadList filter={DownloadFilter.list} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/5 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#1F2024]">
      <SectionHeader
        title="媒体"
        count={total}
        activeCount={activeCount}
        onEnter={onEnter}
      />
      <DownloadList filter={DownloadFilter.list} prioritizeActive />
    </div>
  );
};

export default MediaPanel;
