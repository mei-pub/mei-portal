"use client";

// 小说书架管理页（mei-allin 设置集成页挂载）
// - 列表默认只展示公开书架；在蜘蛛纸牌输入过主密码（unlock cookie）后才展示隐藏书架
// - 隐藏书架"打开"= 会话级激活（书架保持 hidden，仅当前浏览器可访问，同一时间仅一个）
// - "隐藏"= 把已打开的隐藏书架重新隐藏（收回访问权）
import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/Toast";

interface LibraryRow {
  id: number;
  name: string;
  hidden: boolean;
  hasPassword: boolean;
}

interface SettingsData {
  libraries: LibraryRow[];
  authenticatedLibraryId: number | null;
  unlocked: boolean;
  activeHiddenId: number | null;
}

const API = "/novels/api";

export default function ManagePage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 新建书架
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newHidden, setNewHidden] = useState(false);

  // 公开书架带密码时打开需要输入密码
  const [passwordFor, setPasswordFor] = useState<LibraryRow | null>(null);
  const [openPassword, setOpenPassword] = useState("");

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API}/settings`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      /* 忽略，保留旧数据 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleOpen(lib: LibraryRow, password?: string) {
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/${lib.hidden ? "open-hidden" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lib.hidden ? { libraryId: lib.id } : { libraryId: lib.id, password: password || "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || "打开失败", "error");
        return;
      }
      showToast(`已打开「${lib.name}」`, "success");
      setPasswordFor(null);
      setOpenPassword("");
      await reload();
    } catch {
      showToast("打开失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRelock() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/relock`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || "操作失败", "error");
        return;
      }
      showToast("已重新隐藏", "success");
      await reload();
    } catch {
      showToast("操作失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(lib: LibraryRow) {
    if (!confirm(`确定要删除书架「${lib.name}」吗？该书架下的所有书籍和章节都会被删除。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/libraries?id=${lib.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || "删除失败", "error");
        return;
      }
      showToast("书架已删除", "success");
      await reload();
    } catch {
      showToast("删除失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) {
      showToast("请输入书架名称", "error");
      return;
    }
    if (newHidden && !data?.unlocked) {
      showToast("需先在蜘蛛纸牌中输入主密码才能创建隐藏书架", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/libraries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), password: newPassword, hidden: newHidden }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || "创建失败", "error");
        return;
      }
      showToast("书架创建成功", "success");
      setShowCreate(false);
      setNewName("");
      setNewPassword("");
      setNewHidden(false);
      await reload();
    } catch {
      showToast("创建失败", "error");
    } finally {
      setBusy(false);
    }
  }

  const libs = data?.libraries || [];
  const currentId = data?.authenticatedLibraryId ?? null;
  const activeHiddenId = data?.activeHiddenId ?? null;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">小说书架管理</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {data?.unlocked
                ? "已解锁：列表包含隐藏书架（隐藏书架仅当前浏览器可访问，同一时间只能打开一个）"
                : "仅展示公开书架；在蜘蛛纸牌中输入主密码后可查看隐藏书架"}
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg border border-[var(--primary)] px-4 py-1.5 text-sm text-[var(--primary)] transition-colors hover:bg-[var(--accent)]"
          >
            {showCreate ? "取消" : "新建书架"}
          </button>
        </div>

        {showCreate && (
          <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] bg-white p-4">
            <div>
              <label className="mb-1 block text-sm font-medium">书架名称</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--primary)] focus:outline-none"
                placeholder="输入书架名称"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">访问密码（可选）</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--primary)] focus:outline-none"
                placeholder="留空则不设密码"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newHidden}
                onChange={(e) => setNewHidden(e.target.checked)}
                disabled={!data?.unlocked}
              />
              创建为隐藏书架{!data?.unlocked && "（需先在蜘蛛纸牌输入主密码）"}
            </label>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="w-full rounded-lg bg-[var(--primary)] py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {busy ? "创建中…" : "创建书架"}
            </button>
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--muted)]">加载中…</p>
        ) : (
          <div className="space-y-2">
            {libs.map((lib) => {
              const isCurrent = lib.id === currentId;
              const isActiveHidden = lib.hidden && lib.id === activeHiddenId;
              return (
                <div
                  key={lib.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{lib.name}</span>
                    {lib.hidden && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">隐藏</span>
                    )}
                    {lib.hasPassword && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">有密码</span>
                    )}
                    {isCurrent && (
                      <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs text-white">当前</span>
                    )}
                    {isActiveHidden && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">已打开</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {!isCurrent && (
                      <button
                        onClick={() => (lib.hidden ? handleOpen(lib) : lib.hasPassword ? (setPasswordFor(lib), setOpenPassword("")) : handleOpen(lib))}
                        disabled={busy}
                        className="text-sm text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)] disabled:opacity-50"
                      >
                        打开书架
                      </button>
                    )}
                    {isActiveHidden && (
                      <button
                        onClick={handleRelock}
                        disabled={busy}
                        className="text-sm text-amber-600 transition-colors hover:text-amber-700 disabled:opacity-50"
                      >
                        隐藏
                      </button>
                    )}
                    {!isCurrent && (
                      <button
                        onClick={() => handleDelete(lib)}
                        disabled={busy}
                        className="text-sm text-[var(--muted)] transition-colors hover:text-red-500 disabled:opacity-50"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {libs.length === 0 && (
              <p className="py-10 text-center text-sm text-[var(--muted)]">暂无书架</p>
            )}
          </div>
        )}

        {/* 公开书架带密码时的打开弹窗 */}
        {passwordFor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setPasswordFor(null)}
          >
            <div
              className="w-80 rounded-xl bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-3 text-sm font-semibold">打开「{passwordFor.name}」</h2>
              <input
                type="password"
                autoFocus
                value={openPassword}
                onChange={(e) => setOpenPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleOpen(passwordFor, openPassword);
                }}
                className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--primary)] focus:outline-none"
                placeholder="输入书架访问密码"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPasswordFor(null)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
                >
                  取消
                </button>
                <button
                  onClick={() => handleOpen(passwordFor, openPassword)}
                  disabled={busy}
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  打开
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
