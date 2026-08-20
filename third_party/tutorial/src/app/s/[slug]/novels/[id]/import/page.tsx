"use client";

import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import MarkdownEditor from "@/components/MarkdownEditor";
import { showToast } from "@/components/Toast";

// 章节预览项
interface ChapterPreview {
  id: string;        // 临时 ID
  title: string;     // 章节标题
  content: string;  // 章节内容
}

type Stage = "edit" | "preview" | "submit";

export default function ImportPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const novelId = params.id as string;

  const [stage, setStage] = useState<Stage>("edit");
  const [fullText, setFullText] = useState("");
  const [chapters, setChapters] = useState<ChapterPreview[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 阶段1：拆分预览
  function handlePreview() {
    if (!fullText.trim()) {
      showToast("请输入小说内容", "error");
      return;
    }

    // 智能拆分章节
    const lines = fullText.split("\n");
    const newChapters: ChapterPreview[] = [];
    let currentChapter: { title: string; content: string[] } | null = null;
    let chapterIdCounter = 0;

    // 章节标题匹配模式
    const chapterPatterns = [
      /^(第[一二三四五六七八九十百千万零\d]+章)\s*(.+)/i,
      /^(第[一二三四五六七八九十百千万零\d]+[节集卷篇部])\s*(.*)/i,
      /^(Chapter\s*\d+)\s*(.*)/i,
      /^[《『](.+?)[》』]$/,
    ];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      let isChapterTitle = false;
      for (const pattern of chapterPatterns) {
        if (pattern.test(trimmedLine)) {
          isChapterTitle = true;
          break;
        }
      }

      if (isChapterTitle || trimmedLine.startsWith("#")) {
        // 保存之前的章节
        if (currentChapter && currentChapter.content.length > 0) {
          newChapters.push({
            id: `temp-${++chapterIdCounter}`,
            title: currentChapter.title,
            content: currentChapter.content.join("\n").trim(),
          });
        }
        // 开始新章节
        const title = trimmedLine.replace(/^#+\s*/, "").trim() ||
                      trimmedLine.replace(/^第[一二三四五六七八九十百千万零\d]+章\s*/i, "").trim() ||
                      trimmedLine;
        currentChapter = { title, content: [] };
      } else {
        if (currentChapter) {
          currentChapter.content.push(trimmedLine);
        } else {
          // 没有标题的作为序章/前言
          if (!currentChapter) {
            currentChapter = { title: "序言", content: [] };
          }
          currentChapter.content.push(trimmedLine);
        }
      }
    }

    // 保存最后一个章节
    if (currentChapter && currentChapter.content.length > 0) {
      newChapters.push({
        id: `temp-${++chapterIdCounter}`,
        title: currentChapter.title,
        content: currentChapter.content.join("\n").trim(),
      });
    }

    // 如果没有拆出章节，按段落数平均拆分
    if (newChapters.length === 0 && lines.length > 0) {
      const paragraphs = lines.filter(l => l.trim());
      const chunkSize = Math.max(10, Math.ceil(paragraphs.length / 10));
      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        const chunk = paragraphs.slice(i, i + chunkSize);
        newChapters.push({
          id: `temp-${++chapterIdCounter}`,
          title: `第 ${Math.floor(i / chunkSize) + 1} 部分`,
          content: chunk.join("\n\n").trim(),
        });
      }
    }

    if (newChapters.length === 0) {
      showToast("未识别到有效内容", "error");
      return;
    }

    setChapters(newChapters);
    setStage("preview");
    showToast(`已拆分为 ${newChapters.length} 个章节`, "info");
  }

  // 修改章节标题
  function updateChapterTitle(id: string, title: string) {
    setChapters(chapters.map(ch => ch.id === id ? { ...ch, title } : ch));
  }

  // 删除章节
  function deleteChapter(id: string) {
    setChapters(chapters.filter(ch => ch.id !== id));
  }

  // 合并相邻章节
  function mergeWithPrev(id: string) {
    const idx = chapters.findIndex(ch => ch.id === id);
    if (idx <= 0) return;
    const prev = chapters[idx - 1];
    const curr = chapters[idx];
    setChapters(chapters.map((ch, i) => {
      if (i === idx - 1) {
        return { ...ch, content: ch.content + "\n\n" + curr.content };
      }
      if (i === idx) return null as any;
      return ch;
    }).filter(Boolean));
  }

  // 阶段2：提交入库
  async function handleSubmit() {
    if (chapters.length === 0) {
      showToast("没有可导入的章节", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/novels/api/novels/${novelId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapters: chapters.map(ch => ({ title: ch.title, content: ch.content }))
        }),
      });
      if (res.ok) {
        showToast("导入成功", "success");
        setStage("submit");
        setTimeout(() => router.push(`/novels/${novelId}`), 1500);
      } else {
        showToast("导入失败", "error");
      }
    } catch {
      showToast("导入失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // 返回编辑
  function handleBackToEdit() {
    setStage("edit");
    setChapters([]);
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6">
        {/* 顶部导航 */}
        <div className="mb-6">
          {/* 标题行：返回 + 标题 + 操作按钮 */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Link
                href={`/s/${slug}/novels/${novelId}`}
                className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">全文导入</h1>
            </div>

            {/* 操作按钮（阶段相关） */}
            <div className="flex items-center gap-2">
              {stage === "edit" && (
                <button
                  onClick={handlePreview}
                  disabled={!fullText.trim()}
                  className="px-4 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
                >
                  预览拆分
                </button>
              )}
              {stage === "preview" && (
                <button
                  onClick={handleSubmit}
                  disabled={submitting || chapters.length === 0}
                  className="px-4 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50"
                >
                  {submitting ? "导入中..." : `确认导入`}
                </button>
              )}
            </div>
          </div>

          {/* 阶段指示器（居中） */}
          <div className="flex items-center justify-center gap-1 text-xs">
            <span className={`px-2 py-1 rounded-full ${stage === "edit" ? "bg-[var(--primary)] text-white" : "bg-green-100 text-green-700"}`}>
              1. 编辑
            </span>
            <span className="text-[var(--muted)] mx-1">→</span>
            <span className={`px-2 py-1 rounded-full ${stage === "preview" ? "bg-[var(--primary)] text-white" : stage === "submit" ? "bg-green-100 text-green-700" : "bg-gray-100 text-[var(--muted)]"}`}>
              2. 预览
            </span>
            <span className="text-[var(--muted)] mx-1">→</span>
            <span className={`px-2 py-1 rounded-full ${stage === "submit" ? "bg-green-100 text-green-700" : "bg-gray-100 text-[var(--muted)]"}`}>
              3. 入库
            </span>
          </div>
        </div>

        {/* 阶段1：编辑 */}
        {stage === "edit" && (
          <>
            <div className="bg-white rounded-xl border border-[var(--border)] p-4 mb-4">
              <h2 className="text-sm font-medium mb-2">使用说明</h2>
              <ul className="text-xs text-[var(--muted)] space-y-1 list-disc list-inside">
                <li>将小说全文粘贴到下方编辑器中，系统会自动识别章节标题</li>
                <li>支持识别「第X章」「Chapter X」等常见格式</li>
                <li>无法识别时会按段落自动平均拆分</li>
                <li>点击「预览拆分」进入下一阶段调整</li>
              </ul>
            </div>

            <MarkdownEditor
              value={fullText}
              onChange={setFullText}
              minRows={20}
              defaultMode="source"
              placeholder={"在此粘贴小说全文内容...\n\n第一章 开始\n\n这是第一章的内容...\n\n第二章 发展\n\n这是第二章的内容..."}
            />

            <div className="mt-3 text-xs text-[var(--muted)]">
              已输入 {fullText.length} 字符
            </div>
          </>
        )}

        {/* 阶段2：预览 */}
        {stage === "preview" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-[var(--muted)]">
                已拆分 <span className="font-medium text-[var(--primary)]">{chapters.length}</span> 个章节，可调整后再入库
              </p>
              <button
                onClick={handleBackToEdit}
                className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                返回编辑
              </button>
            </div>

            {/* 章节预览列表 */}
            <div className="space-y-3">
              {chapters.map((ch, idx) => (
                <div key={ch.id} className="bg-white rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={ch.title}
                      onChange={e => updateChapterTitle(ch.id, e.target.value)}
                      className="flex-1 px-2 py-1 text-sm font-medium rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--primary)] focus:outline-none"
                    />
                    <span className="text-xs text-[var(--muted)] shrink-0 pt-1">
                      {ch.content.length} 字
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-2 line-clamp-2">
                    {ch.content.slice(0, 100)}...
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    {idx > 0 && (
                      <button
                        onClick={() => mergeWithPrev(ch.id)}
                        className="text-xs text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                      >
                        与上一章合并
                      </button>
                    )}
                    <button
                      onClick={() => deleteChapter(ch.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-center text-xs text-[var(--muted)]">
              共 {chapters.length} 个章节，确认后批量导入
            </div>
          </>
        )}

        {/* 阶段3：完成 */}
        {stage === "submit" && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">✓</div>
            <h2 className="text-xl font-bold text-green-600 mb-2">导入成功</h2>
            <p className="text-[var(--muted)]">正在跳转...</p>
          </div>
        )}
      </main>
    </>
  );
}