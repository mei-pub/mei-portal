"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import SitePanel from "@/components/SitePanel";

export default function NewNovelPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const [form, setForm] = useState({
    title: "",
    slug: "",
    author: "",
    description: "",
    cover_url: "",
    icon: "",
    icon_color: "",
    category: "",
    tags: [] as string[],
    status: "ongoing",
    rating: 5,
  });
  const [coverUploading, setCoverUploading] = useState(false);
  async function uploadCover(file: File) {
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/novels/api/upload-image", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.dataUrl) setForm(f => ({ ...f, cover_url: data.dataUrl }));
    } catch {} finally { setCoverUploading(false); }
  }
  const [tagInput, setTagInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/novels/api/novels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/s/${slug}/novels/${data.slug || data.id}`);
      }
    } catch (err) {
      console.error("Failed to create novel:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SitePanel />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">添加新小说</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              form="novel-form"
              disabled={submitting}
              className="px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
            >
              {submitting ? "创建中..." : "创建小说"}
            </button>
          </div>
        </div>
        <form id="novel-form" onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              小说标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              placeholder="请输入小说标题"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              英文标识 <span className="text-xs text-[var(--muted)] font-normal">（路径用，全局唯一，留空自动生成）</span>
            </label>
            <input
              type="text"
              value={form.slug}
              onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              placeholder="如：doupo（小写字母/数字/中划线）"
            />
          </div>

          {/* 封面 / Logo：有封面用封面渲染，无封面有 Logo 用 Logo 渲染 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">小说封面</label>
              <div className="flex items-center gap-2">
                {form.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.cover_url} alt="封面" className="w-10 h-14 rounded object-cover border border-[var(--border)]" />
                )}
                <label className="px-3 py-2 text-xs rounded-lg border border-[var(--border)] cursor-pointer hover:bg-[var(--accent)] transition-colors">
                  {coverUploading ? "上传中..." : "上传封面"}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); }} />
                </label>
                {form.cover_url && (
                  <button type="button" onClick={() => setForm({ ...form, cover_url: "" })} className="text-xs text-red-400 hover:text-red-500">移除</button>
                )}
              </div>
              <input
                type="text"
                value={form.cover_url}
                onChange={e => setForm({ ...form, cover_url: e.target.value })}
                className="mt-2 w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="或粘贴封面图地址"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Logo <span className="text-xs text-[var(--muted)] font-normal">（无封面时展示）</span></label>
              <input
                type="text"
                value={form.icon}
                onChange={e => setForm({ ...form, icon: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="图片地址 / emoji"
              />
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-[var(--muted)]">底色</label>
                <input
                  type="color"
                  value={form.icon_color || "#6366f1"}
                  onChange={e => setForm({ ...form, icon_color: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-[var(--border)]"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">作者</label>
            <input
              type="text"
              value={form.author}
              onChange={e => setForm({ ...form, author: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              placeholder="请输入作者名"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">简介</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-y"
              placeholder="请输入小说简介"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">分类</label>
              <input
                type="text"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="如：玄幻、武侠"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">评分</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={form.rating}
                  onChange={e => setForm({ ...form, rating: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-sm font-medium w-12 text-right">{form.rating}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">标签</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs bg-[var(--accent)] text-[var(--primary)] rounded-full">
                  {tag}
                  <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })} className="hover:text-red-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                    e.preventDefault();
                    const t = tagInput.trim();
                    if (!form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] });
                    setTagInput("");
                  }
                }}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="输入标签后按 Enter 或逗号添加"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">状态</label>
            <select
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="ongoing">连载中</option>
              <option value="completed">已完结</option>
            </select>
          </div>

          {/* buttons moved to title row */}
        </form>
      </main>
    </>
  );
}
