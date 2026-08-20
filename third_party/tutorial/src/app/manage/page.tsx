"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { showToast } from "@/components/Toast";

interface SiteRow {
  id: number;
  slug: string;
  name: string;
  type: "normal" | "secret";
  hasPassword: boolean;
  created_at: string;
}

// 小说站点管理：需主密码解锁（与门户管理密码一致）
export default function ManagePage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [masterPw, setMasterPw] = useState("");
  const [unlockErr, setUnlockErr] = useState("");
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", type: "normal" as "normal" | "secret", password: "" });
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", slug: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 尝试直接拉管理列表：403 = 未解锁
    fetch("/novels/api/sites?manage=1")
      .then(async (res) => {
        if (res.status === 403) { setUnlocked(false); return; }
        const data = await res.json();
        setSites(Array.isArray(data) ? data : []);
        setUnlocked(true);
      })
      .catch(() => setUnlocked(false));
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockErr("");
    const res = await fetch("/novels/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: masterPw }),
    });
    if (res.ok) {
      setUnlocked(true);
      refresh();
    } else {
      setUnlockErr("主密码错误");
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/novels/api/sites?manage=1");
      const data = await res.json();
      setSites(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  async function createSite(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/novels/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`站点「${data.name}」已创建`, "success");
        setForm({ name: "", slug: "", type: "normal", password: "" });
        setCreating(false);
        refresh();
      } else {
        showToast(data.error || "创建失败", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (editForm.name.trim() && editForm.name !== editing.name) body.name = editForm.name.trim();
      if (editForm.slug.trim() && editForm.slug !== editing.slug) body.slug = editForm.slug.trim();
      if (editForm.password) body.password = editForm.password;
      const res = await fetch(`/novels/api/sites/${encodeURIComponent(editing.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("已保存", "success");
        setEditing(null);
        refresh();
      } else {
        showToast(data.error || "保存失败", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeSite(site: SiteRow) {
    if (!confirm(`删除站点「${site.name}」？站内所有小说与章节将一并删除，不可恢复。`)) return;
    const res = await fetch(`/novels/api/sites?slug=${encodeURIComponent(site.slug)}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      showToast("已删除", "success");
      refresh();
    } else {
      showToast(data.error || "删除失败", "error");
    }
  }

  if (unlocked === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="text-[var(--muted)] text-sm">加载中...</p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm bg-white border border-[var(--border)] rounded-2xl shadow-lg p-6">
          <h1 className="text-lg font-bold text-[var(--foreground)] mb-1">站点管理</h1>
          <p className="text-xs text-[var(--muted)] mb-4">输入主密码解锁管理功能</p>
          <form onSubmit={unlock} className="flex gap-2">
            <input
              type="password"
              value={masterPw}
              onChange={(e) => setMasterPw(e.target.value)}
              placeholder="主密码"
              autoFocus
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors">
              解锁
            </button>
          </form>
          {unlockErr && <p className="mt-3 text-xs text-red-500 text-center">{unlockErr}</p>}
          <Link href="/" className="block mt-4 text-xs text-[var(--muted)] hover:text-[var(--foreground)] text-center transition-colors">
            返回站点列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold">小说站点管理</h1>
          </div>
          <button
            onClick={() => setCreating(!creating)}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors"
          >
            {creating ? "取消" : "新建站点"}
          </button>
        </div>

        {creating && (
          <form onSubmit={createSite} className="bg-white rounded-xl border border-[var(--border)] p-5 mb-6 space-y-4">
            <h2 className="font-semibold text-sm">新建小说站点</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">显示名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：天一阁"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">标识（路径用，留空自动生成）</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                  placeholder="如：tianyi（小写字母/数字/中划线）"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-2">站点类型（创建后不可修改）</label>
              <div className="flex gap-3">
                {(["normal", "secret"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className={`flex-1 py-3 text-sm rounded-xl border transition-all ${form.type === t ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--primary)] font-medium" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]/50"}`}
                  >
                    {t === "normal" ? "普通站点" : "隐秘站点"}
                    <span className="block text-xs font-normal mt-1 opacity-70">
                      {t === "normal" ? "公开可访问，无需密码" : "需要开启密码才能访问"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {form.type === "secret" && (
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">开启密码 *</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="隐秘站点的开启密码"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
                <p className="text-xs text-[var(--muted)] mt-1">开启方式：门户首页搜索框输入 open:标识:密码</p>
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !form.name.trim() || (form.type === "secret" && !form.password)}
              className="px-6 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
            >
              创建
            </button>
          </form>
        )}

        {editing && (
          <form onSubmit={saveEdit} className="bg-white rounded-xl border border-[var(--primary)] p-5 mb-6 space-y-4">
            <h2 className="font-semibold text-sm">
              编辑站点：{editing.name}
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">{editing.type === "secret" ? "隐秘站点" : "普通站点"}（类型不可修改）</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">显示名称</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">标识（修改后旧路径失效）</label>
                <input
                  type="text"
                  value={editForm.slug}
                  onChange={(e) => setEditForm({ ...editForm, slug: e.target.value.toLowerCase() })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>
            {editing.type === "secret" && (
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">开启密码（留空不修改）</label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={busy} className="px-6 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50">
                保存
              </button>
              <button type="button" onClick={() => setEditing(null)} className="px-6 py-2 text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors">
                取消
              </button>
            </div>
          </form>
        )}

        <div className="space-y-3">
          {loading ? (
            <p className="text-center py-10 text-[var(--muted)] text-sm">加载中...</p>
          ) : sites.length === 0 ? (
            <p className="text-center py-10 text-[var(--muted)] text-sm">暂无站点</p>
          ) : (
            sites.map((site) => (
              <div key={site.id} className="bg-white rounded-xl border border-[var(--border)] p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--foreground)] truncate">{site.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${site.type === "secret" ? "bg-purple-100 text-purple-600" : "bg-green-100 text-green-600"}`}>
                      {site.type === "secret" ? "隐秘" : "普通"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    标识 <code className="bg-gray-100 px-1 rounded">/{site.slug}</code> · 路径 <code className="bg-gray-100 px-1 rounded">/novels/s/{site.slug}</code>
                  </div>
                </div>
                <Link
                  href={`/s/${site.slug}`}
                  className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)] transition-colors"
                >
                  进入
                </Link>
                <button
                  onClick={() => { setEditing(site); setEditForm({ name: site.name, slug: site.slug, password: "" }); }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)] transition-colors"
                >
                  编辑
                </button>
                <button
                  onClick={() => removeSite(site)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
