// 全部视图段内的提示条（加载失败 / 空态 / 轻量加载）：
// 不用整页居中 Empty，保持段内自然高度，某类型服务不可用只影响自己这一段。
import { type FC } from "react";
import { cn } from "@/utils";

interface InlineNoticeProps {
  text: string;
  /** 错误提示（红色系），其余为中性灰 */
  error?: boolean;
}

export const InlineNotice: FC<InlineNoticeProps> = ({ text, error }) => (
  <div
    className={cn(
      "flex items-center justify-center rounded-lg border border-dashed px-3 py-4 text-xs",
      error
        ? "border-red-300/70 text-red-500 dark:border-red-900/60 dark:text-red-400"
        : "border-black/10 text-[#B3B3B3] dark:border-white/10 dark:text-[#515257]",
    )}
  >
    {text}
  </div>
);
