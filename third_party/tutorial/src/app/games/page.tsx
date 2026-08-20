"use client";
import { useState } from "react";
import Navbar from "@/components/Navbar";
export default function GamesPage() {
  const [pokerDialog, setPokerDialog] = useState(false);
  // 德州扑克设置
  const [pokerAICount, setPokerAICount] = useState(3);
  const [pokerChips, setPokerChips] = useState(1000);
  const [pokerNickname, setPokerNickname] = useState("");
  function startPokerGame() {
    if (!pokerNickname.trim()) return;
    window.location.href = `/games/poker?ai=${pokerAICount}&chips=${pokerChips}&nickname=${encodeURIComponent(pokerNickname)}`;
  }
  return (
    <>
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-bold text-center mb-2 text-[var(--foreground)]">🎮 游戏中心</h1>
        <p className="text-center text-[var(--muted)] mb-8">选择你喜欢玩的纸牌游戏</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 德州扑克 */}
          <div className="bg-white rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <div className="h-48 bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center">
              <div className="text-6xl">🃋</div>
            </div>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-2">德州扑克</h2>
              <p className="text-sm text-[var(--muted)] mb-4">
                与 AI 对手对战，考验你的策略和心理战能力。
              </p>
              <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-4">
                <span className="px-2 py-1 bg-red-100 text-red-700 rounded">多人</span>
                <span>智能 AI</span>
              </div>
              <button
                onClick={() => setPokerDialog(true)}
                className="w-full py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                开始游戏
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* 德州扑克对话框 */}
      {pokerDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPokerDialog(false)}>
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">德州扑克</h2>
              <button onClick={() => setPokerDialog(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">游戏昵称</label>
                <input
                  type="text"
                  value={pokerNickname}
                  onChange={e => setPokerNickname(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") startPokerGame(); }}
                  className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="输入你的昵称"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">AI 对手数量</label>
                <div className="flex gap-2">
                  {[2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setPokerAICount(n)}
                      className={`flex-1 py-2 text-xs rounded-md transition-colors ${
                        pokerAICount === n
                          ? "border-2 border-red-600 bg-red-50 text-red-700 font-medium"
                          : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {n} 人
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">初始筹码</label>
                <div className="flex gap-2">
                  {[500, 1000, 2000, 5000].map(c => (
                    <button
                      key={c}
                      onClick={() => setPokerChips(c)}
                      className={`flex-1 py-2 text-xs rounded-md transition-colors ${
                        pokerChips === c
                          ? "border-2 border-red-600 bg-red-50 text-red-700 font-medium"
                          : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={startPokerGame}
                  disabled={!pokerNickname.trim()}
                  className="flex-1 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  开始游戏
                </button>
                <button onClick={() => setPokerDialog(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
