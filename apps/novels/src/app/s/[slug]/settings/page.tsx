"use client";
import { useEffect, useState, useRef } from "react";
import Link from "@/components/Link";
import SitePanel from "@/components/SitePanel";
import { useSite } from "@/components/SiteContext";
import { showToast } from "@/components/Toast";
import { triggerBrowserDownload } from "@/lib/browser-download";

// 站点设置：显示名称 / 开启密码（仅隐秘站点）/ 数据备份
export default function SettingsPage() {
  const site = useSite();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(site.name || "");
  }, [site.name]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (password && password !== confirmPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const body: { name: string; password?: string } = { name };
      if (password) body.password = password;
      const res = await fetch("/novels/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // 改了开启密码后刷新 ns-open 记录，保持站点可访问
        if (password && site.type === "secret") {
          await fetch("/novels/api/gate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "open", slug: site.slug, password }),
          });
        }
        setMessage("设置已保存");
        setPassword("");
        setConfirmPassword("");
        setTimeout(() => window.location.reload(), 500);
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error || "保存失败");
      }
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/novels/api/backup/export", { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        // 禁止手搓 a.click()+同步 revoke：会毁掉下载（见 browser-download 注释）
        triggerBrowserDownload(
          blob,
          res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "novels-backup.json",
        );
        showToast("导出成功", "success");
      } else {
        showToast("导出失败", "error");
      }
    } catch {
      showToast("导出失败", "error");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      showToast("请选择 JSON 文件", "error");
      return;
    }
    if (!confirm("导入会将数据添加到当前站点，确定继续吗？")) {
      e.target.value = "";
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/novels/api/backup/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        showToast(`成功导入 ${data.imported} 本书籍`, "success");
        if (data.errors?.length > 0) {
          showToast(`有 ${data.errors.length} 本导入失败`, "error");
        }
        setTimeout(() => window.location.reload(), 1000);
      } else {
        showToast(data.error || "导入失败", "error");
      }
    } catch {
      showToast("导入失败", "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <SitePanel />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/s/${site.slug}`}
            prefetch={false}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold">站点设置</h1>
          <span className="text-xs text-[var(--muted)]">/{site.slug} · {site.type === "secret" ? "隐秘站点" : "普通站点"}</span>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-white rounded-xl border border-[var(--border)] p-5 space-y-4">
            <h2 className="font-semibold text-sm">站点名称</h2>
            <div>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="站点显示名称"
              />
            </div>
          </div>

          {site.type === "secret" && (
            <div className="bg-white rounded-xl border border-[var(--border)] p-5 space-y-4">
              <h2 className="font-semibold text-sm">开启密码</h2>
              <p className="text-xs text-[var(--muted)]">
                隐秘站点通过首页搜索框 open:{site.slug}:密码 开启。留空则不修改密码。
              </p>
              <div>
                <label className="block text-sm font-medium mb-1.5">新密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  placeholder="输入新密码（留空不修改）"
                />
              </div>
              {password && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">确认密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    placeholder="再次输入密码"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="mei-btn-primary"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>

          {message && (
            <div className={`text-sm px-4 py-2 rounded-lg ${message.includes("失败") || message.includes("不一致") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
              {message}
            </div>
          )}
        </form>

        {/* Backup & Restore */}
        <div className="mt-6 bg-white rounded-xl border border-[var(--border)] p-5 space-y-4">
          <h2 className="font-semibold text-sm">数据备份</h2>
          <p className="text-xs text-[var(--muted)]">
            导出当前站点的所有小说和章节为 JSON 文件，可用于数据迁移或备份。
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting || importing}
              className="mei-btn-primary"
            >
              {exporting ? "导出中..." : "导出备份"}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={exporting || importing}
              className="px-6 py-2 text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {importing ? "导入中..." : "导入备份"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
