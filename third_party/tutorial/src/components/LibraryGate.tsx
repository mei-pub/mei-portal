"use client";

// 书架门控页（替代原蜘蛛纸牌伪装页）
// 职责：1) 展示书架列表，点击进入（无密码直接进入，有密码就地输入）
//       2) 隐藏书架入口：输入主密码解锁后，隐藏书架出现在列表中
//       3) 配合 ?lib=N：目标书架需要密码时自动预选并聚焦密码框
import { useEffect, useRef, useState } from "react";

export interface GateLibrary {
  id: number;
  name: string;
  hidden?: number;
  hasPassword?: boolean;
}

export default function LibraryGate({
  libraries,
  unlocked,
  targetLibId,
  onLogin,
  onUnlockMaster,
}: {
  libraries: GateLibrary[];
  unlocked: boolean;
  targetLibId?: number | null;
  onLogin: (libraryId: number, password: string) => Promise<boolean>;
  onUnlockMaster: (password: string) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(targetLibId ?? null);
  const [password, setPassword] = useState("");
  const [masterPw, setMasterPw] = useState("");
  const [showMaster, setShowMaster] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  const selected = libraries.find((l) => l.id === selectedId) || null;

  // 目标书架需要密码时自动聚焦密码框
  useEffect(() => {
    if (selected?.hasPassword) pwRef.current?.focus();
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enter(lib: GateLibrary, pw: string) {
    setBusy(true);
    setError("");
    const ok = await onLogin(lib.id, pw);
    setBusy(false);
    if (!ok) setError(lib.hidden ? "密码错误（隐藏书架可用主密码打开）" : "密码错误");
  }

  function handlePick(lib: GateLibrary) {
    setError("");
    setPassword("");
    if (!lib.hasPassword) {
      void enter(lib, "");
    } else {
      setSelectedId(lib.id);
    }
  }

  async function handleMasterUnlock() {
    if (!masterPw) return;
    setBusy(true);
    setError("");
    const ok = await onUnlockMaster(masterPw);
    setBusy(false);
    if (!ok) setError("主密码错误");
    else setMasterPw("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-sm bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--foreground)]">选择书架</h1>
            <p className="text-xs text-[var(--muted)]">选择一个书架进入阅读</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {libraries.map((lib) => (
            <div key={lib.id}>
              <button
                type="button"
                onClick={() => handlePick(lib)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                  selectedId === lib.id
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[var(--foreground)] truncate">{lib.name}</span>
                  {!!lib.hidden && <span className="block text-[11px] text-[var(--muted)] mt-0.5">隐藏书架</span>}
                </span>
                {lib.hasPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--muted)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--muted)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
              {/* 选中且有密码：就地输入 */}
              {selectedId === lib.id && lib.hasPassword && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); void enter(lib, password); }}
                >
                  <input
                    ref={pwRef}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入书架密码"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  <button
                    type="submit"
                    disabled={busy || !password}
                    className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
                  >
                    进入
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>

        {/* 隐藏书架入口（未解锁时） */}
        {!unlocked && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            {!showMaster ? (
              <button
                type="button"
                onClick={() => setShowMaster(true)}
                className="w-full text-center text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-1"
              >
                打开隐藏书架
              </button>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); void handleMasterUnlock(); }}
              >
                <input
                  type="password"
                  value={masterPw}
                  onChange={(e) => setMasterPw(e.target.value)}
                  placeholder="输入主密码"
                  autoFocus
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
                <button
                  type="submit"
                  disabled={busy || !masterPw}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50 transition-colors"
                >
                  解锁
                </button>
              </form>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-500 text-center">{error}</p>}
        {busy && <p className="mt-3 text-xs text-[var(--muted)] text-center">验证中…</p>}
      </div>
    </div>
  );
}
