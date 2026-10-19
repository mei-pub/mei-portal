// 下载中心表格基元 —— 任务队列（download-list）是基准实现；影视/音乐下载库
// 继承同一列网格与皮相（round-C ⑤ 对齐）：列宽 16|28|flex|88|118|124、
// 圆角卡 + 表头灰带 + 行 hover/选中蓝底。修改时与任务队列内联常量保持同值。
export const TABLE_CLS =
  "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.06] bg-white/85 shadow-[0_1px_2px_rgba(16,24,40,0.03)] dark:border-white/[0.08] dark:bg-[#1F2024]";

export const HEADER_CLS =
  "flex shrink-0 flex-row items-center gap-2.5 border-b border-black/[0.06] bg-black/[0.015] px-3 py-2 text-[11px] font-medium leading-none text-gray-400 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-gray-500";

export const ROW_CLS =
  "group relative flex flex-row items-center gap-2.5 border-b border-black/[0.04] px-3 py-2 transition-colors duration-150 last:border-b-0 hover:bg-black/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]";

export const ROW_SELECTED_CLS = "bg-blue-500/[0.07] dark:bg-blue-400/[0.09]";

/** 吸顶工具条（对齐任务队列代理：全选三态 + 状态页签 + 搜索 + 全部起停） */
export const TOOLBAR_CLS =
  "sticky top-0 z-20 flex flex-row flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/[0.04] bg-white/85 px-3 py-2 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[#1F2024]/85";
