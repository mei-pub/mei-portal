"use client";

import { useCallback, useState } from "react";
import SpiderSolitaire from "@/components/SpiderSolitaire";

/**
 * 蜘蛛纸牌独立游戏页
 *
 * - 始终可见的 Shell 一级入口
 * - 用户输入的"昵称"若匹配某书架密码 → 自动登录该书架并跳转 /novels?lib={id}
 * - 不匹配则当作普通游戏昵称继续游玩
 */
function SpiderGameContent() {
  const [loggingIn, setLoggingIn] = useState(false);

  const handleNewGameNickname = useCallback(async (nickname: string) => {
    if (!nickname || loggingIn) return;
    try {
      const res = await fetch("/novels/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.matched && data.success) {
          setLoggingIn(true);
          try { localStorage.setItem("mei-disguise", "false"); } catch {}
          window.location.href = `/novels?lib=${data.libraryId}`;
        }
        // 未匹配：当作普通游戏昵称，继续游玩
      }
    } catch {
      // 网络错误：忽略，继续游戏
    }
  }, [loggingIn]);

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
  return <SpiderGameContent />;
}
