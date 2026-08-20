"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Navbar from "@/components/Navbar";

export default function NewNovelPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const [form, setForm] = useState({
    title: "",
    author: "",
    description: "",
    category: "",
    tags: [] as string[],
    status: "ongoing",
    rating: 5,
  });
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
        router.push(`/s/${slug}/novels/${data.id}`);
      }
    } catch (err) {
      console.error("Failed to create novel:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Navbar />
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
