"use client";

import { useCallback, Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import SpiderSolitaire from "@/components/games/SpiderSolitaire";

/**
 * 蜘蛛纸牌独立游戏页（伪装入口 /games/spider）
 *
 * 伪装模式下 Shell 门户的"蜘蛛纸牌"卡片指向 /games/spider（无 /novels 前缀），
 * 因此该页必须能在没有 ?nickname= 查询参数时直接开局——SpiderSolitaire 组件
 * 自带"新游戏"对话框可让用户输入昵称。
 *
 * 与 AuthProvider 内的伪装一致：若用户输入的昵称匹配某书架密码，
 * 自动登录该书架并跳转到 /novels 阅读界面；否则当作普通游戏昵称继续游玩。
 */
function SpiderGameContent() {
  const router = useRouter();
  const [loggingIn, setLoggingIn] = useState(false);

  const handleNewGameNickname = useCallback(
    async (nickname: string) => {
      if (!nickname || loggingIn) return;
      try {
        const res = await fetch("/novels/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname }),
        });
        if (res.ok) {
          const data = await res.json();
          // 匹配到书架密码 → 自动登录，跳转到书架
          if (data.matched && data.success) {
            setLoggingIn(true);
            router.push(`/novels?lib=${data.libraryId}`);
          }
          // 未匹配：当作普通游戏昵称，继续游玩
        }
      } catch {
        // 网络错误：忽略，继续游戏
      }
    },
    [loggingIn, router]
  );

  if (loggingIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-600 to-green-900">
        <div className="text-center text-white">
          <div className="text-6xl mb-4">🃏</div>
          <h1 className="text-2xl font-bold mb-4">蜘蛛纸牌</h1>
          <p className="text-green-200 mb-6">正在进入书架...</p>
        </div>
      </div>
    );
  }

  return <SpiderSolitaire onNewGameNickname={handleNewGameNickname} />;
}

export default function SpiderGamePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-600 to-green-900">
          <div className="text-center text-white">
            <div className="text-6xl mb-4">🃏</div>
            <h1 className="text-2xl font-bold mb-4">蜘蛛纸牌</h1>
            <p className="text-green-200 mb-6">加载中...</p>
          </div>
        </div>
      }
    >
      <SpiderGameContent />
    </Suspense>
  );
}
