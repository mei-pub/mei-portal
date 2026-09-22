import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "游戏中心",
  description: "纸牌游戏合集",
};

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
