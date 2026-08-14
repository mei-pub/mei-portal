import type { Metadata } from "next";

/**
 * 蜘蛛纸牌独立游戏页的 metadata
 * 覆盖根 layout 的"小说书架"标题，使浏览器标签显示"蜘蛛纸牌"
 */
export const metadata: Metadata = {
  title: "蜘蛛纸牌",
  description: "经典单人纸牌游戏",
};

export default function SpiderGameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
