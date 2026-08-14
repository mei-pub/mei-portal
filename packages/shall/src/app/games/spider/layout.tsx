import type { Metadata } from "next";
import Script from "next/script";
import "./spider-game.css";

/**
 * 蜘蛛纸牌独立游戏页（Shell 框架级入口）
 *
 * 这是 Shell 门户的一级应用入口，始终在门户首页可见。
 * 用户在此输入的"昵称"若匹配某书架密码，会自动打开该书架。
 *
 * 使用 next/script 加载统一顶栏（topbar.js），避免被 Next.js hydration 移除。
 * （nginx sub_filter 注入的 <script> 会被 React hydration 清除）
 */
export const metadata: Metadata = {
  title: "蜘蛛纸牌",
  description: "经典单人纸牌游戏",
  icons: {
    icon: [{ url: "/games/spider/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/games/spider/icon.svg" }],
  },
};

export default function SpiderGameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        id="mei-topbar-script"
        src="/__shell/topbar.js"
        data-app="spider"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
}
