"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import SitePanel from "@/components/SitePanel";
import MarkdownEditor from "@/components/MarkdownEditor";
import { showToast } from "@/components/Toast";

export default function NewChapterPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const novelId = params.id as string;
  const [form, setForm] = useState({ title: "", content: "", chapter_order: 0 });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      showToast("请输入章节标题", "error");
      return;
    }
    if (!form.content.trim()) {
      showToast("请输入章节内容", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/novels/api/novels/${novelId}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        showToast("章节保存成功", "success");
        setTimeout(() => router.push(`/s/${slug}/novels/${novelId}`), 800);
      } else {
        showToast("保存失败，请重试", "error");
      }
    } catch (err) {
      console.error("Failed to create chapter:", err);
      showToast("保存失败，请重试", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SitePanel />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/s/${slug}/novels/${novelId}`}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold">添加新章节</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-1.5 text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors"
            >
              取消
            </button>
            <button
              form="chapter-form"
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
            >
              {submitting ? "保存中..." : "保存章节"}
            </button>
          </div>
        </div>
        <form id="chapter-form" onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-[1fr_100px] gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                章节标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="第一章 开始"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">排序</label>
              <input
                type="number"
                min={0}
                value={form.chapter_order}
                onChange={e => setForm({ ...form, chapter_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              章节内容 <span className="text-red-500">*</span>
            </label>
            <MarkdownEditor
              value={form.content}
              onChange={content => setForm({ ...form, content })}
              minRows={20}
              defaultMode="source"
              placeholder={"请输入章节内容（支持 Markdown 格式）...\n\n**粗体文字**\n*斜体文字*\n\n可粘贴网页内容(含图片)或截图"}
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              已输入 {form.content.length} 字 | 支持粘贴网页内容(含图片) · 截图 · Markdown 格式
            </p>
          </div>
        </form>
      </main>
    </>
  );
}
