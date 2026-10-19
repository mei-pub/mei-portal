import { useMemoizedFn } from "ahooks";
import {
  cloneElement,
  memo,
  type PropsWithChildren,
  type ReactElement,
  type SVGProps,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { themeSelector, useSessionStore } from "@/store/session";
import { cn } from "@/utils";

interface Props extends PropsWithChildren {
  title?: string;
  /** 透传点击事件（点击 e.clientX/Y 可用于打开浮层菜单定位，如「加入播放列表」） */
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  /** 图标元素需接受 className / fill / width / height（cloneElement 注入尺寸/配色；
   *  antd 图标与自定义 svg 的 props 均为 SVGProps 超集，故统一按 SVGProps 收口） */
  icon?: ReactElement<SVGProps<SVGSVGElement> & { className?: string; fill?: string }>;
  /** sm=16px 内联小图标（默认，原规格）；md=26px 表格操作区（下载中心三列表） */
  size?: "sm" | "md";
}

export const IconButton = memo(function IconButton({
  children,
  disabled,
  title,
  onClick,
  icon,
  size = "sm",
}: Props) {
  const { theme } = useSessionStore(useShallow(themeSelector));
  const handleClick = useMemoizedFn((e: React.MouseEvent) => {
    if (disabled) {
      return;
    }
    onClick?.(e);
  });

  // md 表格操作按钮：图标统一 15px 槽位、currentColor 着色（hover 随按钮变色）。
  // 注意两类图标宿主不同——antd 图标是 span 包 svg（按 1em 缩放，走 fontSize），
  // 自定义 svg 是根 svg（走 width/height 属性）；fill 只注入 sm（自定义图标路径
  // 已改为 currentColor，md 不再注入写死颜色，避免 hover 反馈失效）
  const styledIcon =
    icon && size === "md"
      ? cloneElement(icon, {
          width: 15,
          height: 15,
          style: { fontSize: 15 },
        })
      : icon
        ? cloneElement(icon, {
            className: cn(
              "w-full h-full text-[#020817] dark:text-[#B4B4B4]",
              icon.props.className,
            ),
            fill: theme === "dark" ? "#B4B4B4" : "#020817",
          })
        : undefined;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-row items-center justify-center rounded-md transition-colors duration-100",
        size === "md"
          ? "h-[26px] w-[26px] cursor-pointer text-gray-500 hover:bg-black/[0.06] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
          : "h-4 w-4 cursor-pointer hover:opacity-70",
        {
          "cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent": disabled,
        },
      )}
      title={title}
      // 行内操作按钮显式豁免多选 hook（use-marquee-select INTERACTIVE 容此
      // 标记）：否则 IconButton 渲染为 div 不命中 button 选择器，点暂停/继续
      // 等动作会漫溢到行交互（误弹详情/误触发选中）
      data-marquee-skip=""
      onClick={handleClick}
    >
      {styledIcon}
      {children}
    </div>
  );
});
