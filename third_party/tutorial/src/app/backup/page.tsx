"use client";

// 小说数据备份管理：导出 zip / SQLite / WebDAV / S3，导入 zip / SQLite / WebDAV / S3
// 需主密码解锁（与站点管理一致）
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { showToast } from "@/components/Toast";

const card = "bg-white rounded-2xl border border-[var(--border)] p-5 space-y-4";
const input = "mei-input";
const label = "block text-xs font-medium text-[var(--muted)] mb-1";
const btnPrimary = "px-4 py-2 text-sm rounded-xl bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50";
const btnGhost = "px-4 py-2 text-sm rounded-xl border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)] transition-colors disabled:opacity-50";

export default function BackupPage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [masterPw, setMasterPw] = useState("");
  const [busy, setBusy] = useState("");
  const [webdav, setWebdav] = useState({ url: "", username: "", password: "" });
  const [s3, setS3] = useState({ endpoint: "", region: "", bucket: "", key: "backups/novels-backup.zip", accessKey: "", secretKey: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/novels/api/sites?manage=1").then((r) => setUnlocked(r.status !== 403)).catch(() => setUnlocked(false));
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/novels/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: masterPw }),
    });
    if (res.ok) setUnlocked(true);
    else showToast("主密码错误", "error");
  }

  async function download(format: "zip" | "sqlite") {
    setBusy(format);
    try {
      const res = await fetch(`/novels/api/admin/backup?format=${format}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `novels-backup.${format === "zip" ? "zip" : "db"}`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("导出成功", "success");
    } catch {
      showToast("导出失败", "error");
    } finally { setBusy(""); }
  }

  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`导入「${file.name}」？数据将以合并方式导入（已有站点/书籍自动去重）。`)) { e.target.value = ""; return; }
    setBusy("import");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/novels/api/admin/backup", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        showToast(`导入完成：站点 +${data.sites}，书籍 +${data.novels}，章节 +${data.chapters}（跳过 ${data.skipped} 项已有数据）`, "success");
      } else {
        showToast(data.error || "导入失败", "error");
      }
    } catch {
      showToast("导入失败", "error");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remote(direction: "export" | "import", target: "webdav" | "s3") {
    if (direction === "import" && !confirm(`从 ${target === "webdav" ? "WebDAV" : "S3"} 拉取备份并合并导入？`)) return;
    setBusy(`${target}-${direction}`);
    try {
      const res = await fetch("/novels/api/admin/backup/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, target, config: target === "webdav" ? webdav : s3 }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(direction === "export" ? (data.message || "同步成功") : `导入完成：站点 +${data.sites}，书籍 +${data.novels}，章节 +${data.chapters}`, "success");
      } else {
        showToast(data.error || "同步失败", "error");
      }
    } catch {
      showToast("同步失败", "error");
    } finally { setBusy(""); }
  }

  if (unlocked === null) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--background)]"><p className="text-[var(--muted)] text-sm">加载中...</p></div>;
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm bg-white border border-[var(--border)] rounded-2xl shadow-lg p-6">
          <h1 className="text-lg font-bold text-[var(--foreground)] mb-1">数据备份</h1>
          <p className="text-xs text-[var(--muted)] mb-4">输入主密码解锁</p>
          <form onSubmit={unlock} className="flex gap-2">
            <input type="password" value={masterPw} onChange={(e) => setMasterPw(e.target.value)} placeholder="主密码" autoFocus className={input} />
            <button type="submit" className={btnPrimary}>解锁</button>
          </form>
          <Link href="/" className="block mt-4 text-xs text-[var(--muted)] hover:text-[var(--foreground)] text-center transition-colors">返回站点列表</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/manage" className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <h1 className="text-xl font-bold">小说数据备份</h1>
        </div>

        {/* 导出 */}
        <section className={card}>
          <h2 className="font-semibold text-sm">导出</h2>
          <p className="text-xs text-[var(--muted)]">导出全部站点、书籍与章节。zip 包含数据库与元信息；SQLite 为原始数据库文件。</p>
          <div className="flex gap-3">
            <button onClick={() => download("zip")} disabled={!!busy} className={btnPrimary}>{busy === "zip" ? "导出中..." : "导出 ZIP 包"}</button>
            <button onClick={() => download("sqlite")} disabled={!!busy} className={btnGhost}>{busy === "sqlite" ? "导出中..." : "导出 SQLite 文件"}</button>
          </div>
        </section>

        {/* 导入 */}
        <section className={card}>
          <h2 className="font-semibold text-sm">导入</h2>
          <p className="text-xs text-[var(--muted)]">支持 zip 包 / SQLite 文件（自动兼容旧版数据结构），合并导入并自动去重。</p>
          <input ref={fileRef} type="file" accept=".zip,.db,.sqlite,.sqlite3" onChange={importFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={btnPrimary}>{busy === "import" ? "导入中..." : "选择文件导入"}</button>
        </section>

        {/* WebDAV */}
        <section className={card}>
          <h2 className="font-semibold text-sm">WebDAV 同步</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className={label}>文件地址</label><input className={input} placeholder="https://dav.example.com/backups/novels.zip" value={webdav.url} onChange={(e) => setWebdav({ ...webdav, url: e.target.value })} /></div>
            <div><label className={label}>用户名</label><input className={input} value={webdav.username} onChange={(e) => setWebdav({ ...webdav, username: e.target.value })} /></div>
            <div><label className={label}>密码</label><input type="password" className={input} value={webdav.password} onChange={(e) => setWebdav({ ...webdav, password: e.target.value })} /></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => remote("export", "webdav")} disabled={!!busy || !webdav.url} className={btnPrimary}>{busy === "webdav-export" ? "同步中..." : "同步到 WebDAV"}</button>
            <button onClick={() => remote("import", "webdav")} disabled={!!busy || !webdav.url} className={btnGhost}>{busy === "webdav-import" ? "拉取中..." : "从 WebDAV 导入"}</button>
          </div>
        </section>

        {/* S3 */}
        <section className={card}>
          <h2 className="font-semibold text-sm">S3 同步（兼容 MinIO 等）</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className={label}>Endpoint</label><input className={input} placeholder="https://s3.us-east-1.amazonaws.com" value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} /></div>
            <div><label className={label}>Region</label><input className={input} placeholder="us-east-1" value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} /></div>
            <div><label className={label}>Bucket</label><input className={input} value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className={label}>对象路径（Key）</label><input className={input} value={s3.key} onChange={(e) => setS3({ ...s3, key: e.target.value })} /></div>
            <div><label className={label}>Access Key</label><input className={input} value={s3.accessKey} onChange={(e) => setS3({ ...s3, accessKey: e.target.value })} /></div>
            <div><label className={label}>Secret Key</label><input type="password" className={input} value={s3.secretKey} onChange={(e) => setS3({ ...s3, secretKey: e.target.value })} /></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => remote("export", "s3")} disabled={!!busy || !s3.endpoint || !s3.bucket || !s3.accessKey} className={btnPrimary}>{busy === "s3-export" ? "同步中..." : "同步到 S3"}</button>
            <button onClick={() => remote("import", "s3")} disabled={!!busy || !s3.endpoint || !s3.bucket || !s3.accessKey} className={btnGhost}>{busy === "s3-import" ? "拉取中..." : "从 S3 导入"}</button>
          </div>
        </section>
      </main>
    </>
  );
}
