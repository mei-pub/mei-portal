"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "@/components/Link";
import SitePanel from "@/components/SitePanel";
import MarkdownEditor from "@/components/MarkdownEditor";

export default function EditChapterPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const novelId = params.id as string;
  const chapterId = params.chapterId as string;
  const [form, setForm] = useState({ title: "", content: "", chapter_order: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [novelSlug, setNovelSlug] = useState("");

  // 获取小说 slug 用于路径规范化（防 id 遍历）
  useEffect(() => {
    fetch(`/novels/api/novels/${novelId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.slug) {
          setNovelSlug(d.slug);
          if (novelId !== d.slug) router.replace(`/s/${slug}/novels/${d.slug}/chapters/${chapterId}/edit`);
        }
      })
      .catch(() => {});
  }, [novelId, slug, chapterId, router]);

  useEffect(() => {
    fetchChapter();
  }, [chapterId]);

  async function fetchChapter() {
    try {
      const res = await fetch(`/novels/api/chapters/${chapterId}`);
      if (res.ok) {
        const data = await res.json();
        setForm({
          title: data.title,
          content: data.content || "",
          chapter_order: data.chapter_order || 0,
        });
      }
    } catch (err) {
      console.error("Failed to fetch chapter:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/novels/api/chapters/${chapterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        router.push(`/s/${slug}/novels/${novelSlug || novelId}`);
      }
    } catch (err) {
      console.error("Failed to update chapter:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <SitePanel />
        <div className="text-center py-20 text-[var(--muted)]">加载中...</div>
      </>
    );
  }

  return (
    <>
      <SitePanel />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/s/${slug}/novels/${novelSlug || novelId}`}
              prefetch={false}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold">编辑章节</h1>
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
              form="edit-chapter-form"
              type="submit"
              disabled={submitting}
              className="mei-btn-primary"
            >
              {submitting ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
        <form id="edit-chapter-form" onSubmit={handleSubmit} className="space-y-5">
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
                className="mei-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">排序</label>
              <input
                type="number"
                min={0}
                value={form.chapter_order}
                onChange={e => setForm({ ...form, chapter_order: parseInt(e.target.value) || 0 })}
                className="mei-input"
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
              placeholder={"编辑章节内容（支持 Markdown 格式）...\n\n**粗体文字**\n*斜体文字*\n\n可粘贴网页内容(含图片)或截图"}
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
