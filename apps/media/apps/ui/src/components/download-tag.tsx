import type React from "react";
import { cn } from "@/utils";

interface DownloadTagProps {
  icon?: React.ReactNode;
  text: string;
  color: string;
  className?: string;
  /** 悬停提示（做种徽标显示实时上传速率等） */
  title?: string;
}

export function DownloadTag({
  icon,
  text,
  color,
  className,
  title,
}: DownloadTagProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 cursor-default flex-row items-center gap-1 rounded-full px-2 py-[3px] font-medium shadow-[inset_0_-1px_0_rgba(0,0,0,0.14)]",
        className,
      )}
      style={{ background: color }}
      title={title}
    >
      {icon}
      <span className="text-[11px] leading-none text-white">{text}</span>
    </div>
  );
}
