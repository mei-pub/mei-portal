// 全部视图的段头：类型名 + 计数徽标 + 进行中徽标 + 「进入 →」（锚定对应 tab）
import { type FC } from "react";

interface SectionHeaderProps {
  /** 段类型名（媒体 / 影视 / 音乐） */
  title: string;
  /** 计数徽标（该类型条目总数） */
  count?: number;
  /** 进行中数量（>0 时额外展示「N 进行中」徽标） */
  activeCount?: number;
  /** 「进入 →」回调：切换到对应 tab */
  onEnter?: () => void;
}

export const SectionHeader: FC<SectionHeaderProps> = ({
  title,
  count,
  activeCount,
  onEnter,
}) => (
  <div className="flex shrink-0 flex-row items-center gap-2 px-1">
    <span className="text-sm font-medium text-[#343434] dark:text-white">
      {title}
    </span>
    {count != null && (
      <span className="rounded-full bg-indigo-600/10 px-2 py-0.5 text-[11px] font-medium leading-none text-indigo-600 dark:text-indigo-400">
        {count}
      </span>
    )}
    {activeCount != null && activeCount > 0 && (
      <span className="flex flex-row items-center gap-1 rounded-full bg-sky-600/10 px-2 py-0.5 text-[11px] font-medium leading-none text-sky-600 dark:text-sky-400">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        {activeCount} 进行中
      </span>
    )}
    {onEnter && (
      <button
        type="button"
        onClick={onEnter}
        className="ml-auto shrink-0 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400"
      >
        进入 →
      </button>
    )}
  </div>
);
