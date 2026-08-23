"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import SitePanel from "@/components/SitePanel";
import { showToast } from "@/components/Toast";

interface Novel {
  id: number;
  slug: string;
  title: string;
  author: string;
  description: string;
  cover_url: string;
  icon: string;
  icon_color: string;
  category: string;
  tags: string[];
  status: string;
  word_count: number;
  rating: number;
  chapters: { id: number; title: string; chapter_order: number; word_count: number }[];
  volumes: Volume[];
}

interface Volume {
  id: number;
  title: string;
  position: number;
}

export default function NovelDetailPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const novelId = params.id as string;
  const [novel, setNovel] = useState<Novel | null>(null);
  const [loading, setLoading] = useState(true);

  // 分卷弹层状态
  const [showVolumeModal, setShowVolumeModal] = useState(false);
  const [volumeTitle, setVolumeTitle] = useState("");
  const [volumePosition, setVolumePosition] = useState(0);
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null); // 正在编辑的分卷
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (novelId) fetchNovel();
  }, [novelId]);

  async function fetchNovel() {
    try {
      const res = await fetch(`/novels/api/novels/${novelId}`);
      if (res.ok) {
        const data = await res.json();
       setNovel(data);
        // 规范化路径：数字 id → slug（防遍历，统一新路径体系）
        if (data.slug && novelId !== data.slug) {
          router.replace(`/s/${slug}/novels/${data.slug}`);
        }
        // 默认插入位置为最后一个章节之后
        if (data.chapters?.length > 0) {
          setVolumePosition(data.chapters[data.chapters.length - 1].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch novel:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("确定要删除这本小说吗？所有章节也会被删除。")) return;
    try {
      await fetch(`/novels/api/novels/${novelId}`, { method: "DELETE" });
      router.push(`/s/${slug}`);;
    } catch (err) {
      console.error("Failed to delete novel:", err);
    }
  }

  async function handleDeleteChapter(chapterId: number) {
    if (!confirm("确定要删除这个章节吗？")) return;
    try {
      await fetch(`/novels/api/chapters/${chapterId}`, { method: "DELETE" });
      fetchNovel();
    } catch (err) {
      console.error("Failed to delete chapter:", err);
    }
  }

  // 打开编辑分卷弹层
  function handleEditVolume(volume: Volume) {
    setEditingVolume(volume);
    setVolumeTitle(volume.title);
    setVolumePosition(volume.position);
    setShowVolumeModal(true);
  }

  // 打开新建分卷弹层
  function handleNewVolume() {
    setEditingVolume(null);
    setVolumeTitle("");
    if (novel?.chapters?.length) {
      setVolumePosition(novel.chapters[novel.chapters.length - 1].id);
    } else {
      setVolumePosition(0);
    }
    setShowVolumeModal(true);
  }

  async function handleSaveVolume() {
    if (!volumeTitle.trim()) {
      showToast("请输入分卷名称", "error");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/novels/api/novels/${novelId}/volumes`, {
        method: editingVolume ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingVolume?.id,
          title: volumeTitle.trim(),
          position: volumePosition,
        }),
      });
      if (res.ok) {
        showToast(editingVolume ? "分卷已更新" : "分卷创建成功", "success");
        setShowVolumeModal(false);
        setVolumeTitle("");
        setEditingVolume(null);
        fetchNovel();
      } else {
        showToast(editingVolume ? "更新失败" : "创建失败", "error");
      }
    } catch {
      showToast(editingVolume ? "更新失败" : "创建失败", "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteVolume(volumeId: number) {
    if (!confirm("确定要删除这个分卷吗？")) return;
    try {
      const res = await fetch(`/novels/api/novels/${novelId}/volumes?volumeId=${volumeId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast("分卷已删除", "info");
        fetchNovel();
      }
    } catch (err) {
      console.error("Failed to delete volume:", err);
    }
  }

  function formatWordCount(count: number) {
    if (count >= 10000) return (count / 10000).toFixed(1) + "万字";
    return count + "字";
  }

  // 合并分卷和章节，构建渲染列表
  function buildChapterVolumeList() {
    if (!novel) return [];
    if (!novel.chapters || novel.chapters.length === 0) return [];
    
    const result: (typeof novel.chapters[0] | { isVolume: true; volume: Volume; key: string })[] = [];
    const volumes = novel.volumes || [];
    
    // 添加 position=0 的分卷（小说开头）
    (volumes || []).filter(v => v.position === 0).forEach(v => {
      result.push({ isVolume: true, volume: v, key: `vol-${v.id}` });
    });
    
    // 遍历章节
    (novel.chapters || []).forEach((ch, idx) => {
      // 添加 position 等于当前章节 id 的分卷
      (volumes || []).filter(v => v.position === ch.id).forEach(v => {
        result.push({ isVolume: true, volume: v, key: `vol-${v.id}` });
      });
      // 添加章节
      result.push(ch);
    });
    
    return result;
  }

  // 根据 position 确定分卷属于哪个章节之后
  function getVolumePositionText(position: number, chapters: Novel["chapters"]) {
    if (position === 0) return "小说开头";
    const chapter = chapters.find(ch => ch.id === position);
    if (chapter) return `第 ${chapters.indexOf(chapter) + 1} 章之后`;
    return "未知位置";
  }

  if (loading) {
    return (
      <>
        <SitePanel />
        <div className="text-center py-20 text-[var(--muted)]">加载中...</div>
      </>
    );
  }

  if (!novel) {
    return (
      <>
        <SitePanel />
        <div className="text-center py-20 text-[var(--muted)]">小说不存在</div>
      </>
    );
  }

  // 规范路径标识：优先用 slug，防 id 遍历
  const nid = novel.slug || novelId;
  return (
    <>
      <SitePanel />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Back button */}
        <Link href={`/s/${slug}`} className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)] mb-4 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          返回站点
        </Link>

        {/* Novel Header：封面/Logo 多样式渲染 */}
        <div className="bg-white rounded-xl border border-[var(--border)] p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4 min-w-0">
              {(() => {
                // 封面 > Logo > 书名首字母渐变卡片，保证目录页始终有封面位
                if (novel.cover_url) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={novel.cover_url} alt={novel.title} className="w-20 h-28 rounded-lg object-cover shadow flex-shrink-0" />
                  );
                }
                if (/^(https?:)?\//.test(novel.icon || "")) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={novel.icon} alt={novel.title} className="w-20 h-28 rounded-lg object-contain shadow flex-shrink-0" style={{ background: novel.icon_color || "var(--accent)" }} />
                  );
                }
                const glyph = novel.icon && !novel.icon.includes(":") ? novel.icon : novel.title.slice(0, 1);
                return (
                  <span className="w-20 h-28 rounded-lg flex items-center justify-center shadow flex-shrink-0 text-3xl font-bold text-white" style={{ background: novel.icon_color || "linear-gradient(135deg,#6366f1,#a855f7)" }}>
                    {glyph}
                  </span>
                );
              })()}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                {novel.title}
                {/* 角标 */}
                {(() => {
                  const badgeType = novel.rating >= 9 ? "masterpiece" : novel.rating >= 8 ? "good" : novel.rating >= 7 ? "classic" : null;
                  return badgeType ? (
                    <span className={`inline-block px-2 py-0.5 text-xs font-bold text-white rounded-tl-lg rounded-br-lg ${
                      badgeType === "masterpiece" ? "bg-gradient-to-r from-amber-500 to-red-500" :
                      badgeType === "good" ? "bg-gradient-to-r from-emerald-500 to-teal-500" :
                      "bg-gradient-to-r from-purple-600 to-pink-500"
                    }`}>
                      {badgeType === "masterpiece" ? "神作" : badgeType === "good" ? "佳作" : "经典"}
                    </span>
                  ) : null;
                })()}
              </h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-[var(--muted)]">
                <span>{novel.author || "未知作者"}</span>
                {novel.category && (
                  <span className="px-2 py-0.5 bg-[var(--accent)] rounded-full text-xs">{novel.category}</span>
                )}
                <span className={novel.status === "completed" ? "text-green-500" : "text-orange-400"}>
                  {novel.status === "completed" ? "已完结" : "连载中"}
                </span>
                <span>{formatWordCount(novel.word_count)}</span>
                {novel.rating > 0 && <span className="text-yellow-500">★ {novel.rating}</span>}
              </div>
              {(novel.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {novel.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-gray-100 text-[var(--muted)] rounded-full text-xs">{tag}</span>
                  ))}
                </div>
              )}
              {novel.description && (
                <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">{novel.description}</p>
              )}
            </div>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <Link
                href={`/s/${slug}/novels/${nid}/edit`}
                className="p-2 text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--accent)] rounded-lg transition-colors"
                title="编辑"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </Link>
              <button
                onClick={handleDelete}
                className="p-2 text-[var(--muted)] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="删除"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-3">
              {novel.chapters && novel.chapters.length > 0 ? (
                <>
                  <Link
                    href={`/s/${slug}/novels/${nid}/read`}
                    className="mei-btn-primary"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span className="hidden sm:inline">开始阅读</span>
                  </Link>
                  <Link
                    href={`/s/${slug}/novels/${nid}/read?fulltext=parallel`}
                    className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 text-sm border border-[var(--primary)] text-[var(--primary)] rounded-lg hover:bg-[var(--accent)] transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="hidden sm:inline">全文阅读</span>
                  </Link>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 bg-gray-200 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span className="hidden sm:inline">开始阅读</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 text-sm border border-gray-200 text-gray-400 rounded-lg cursor-not-allowed">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="hidden sm:inline">全文阅读</span>
                  </span>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <Link
                href={`/s/${slug}/novels/${nid}/chapters/new`}
                className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 text-sm border border-[var(--primary)] text-[var(--primary)] rounded-lg hover:bg-[var(--accent)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">添加章节</span>
              </Link>
              <Link
                href={`/s/${slug}/novels/${nid}/import`}
                className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 text-sm border border-[var(--border)] text-[var(--muted)] rounded-lg hover:bg-[var(--accent)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="hidden sm:inline">全文导入</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Chapters & Volumes */}
        <div className="bg-white rounded-xl border border-[var(--border)]">
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                章节目录
                <span className="text-sm font-normal text-[var(--muted)] ml-2">
                  共 {novel.chapters?.length || 0} 章
                </span>
              </h2>
              <button
                onClick={handleNewVolume}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--primary)] border border-[var(--primary)] rounded-lg hover:bg-[var(--accent)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                创建分卷
              </button>
            </div>
          </div>
          {!novel.chapters || novel.chapters.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              <p className="mb-3">暂无章节</p>
              <Link
                href={`/s/${slug}/novels/${nid}/chapters/new`}
                className="text-sm text-[var(--primary)] hover:underline"
              >
                添加第一个章节
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {/* 渲染分卷和章节混合列表 */}
              {buildChapterVolumeList().map((item) => {
                if ('isVolume' in item && item.isVolume) {
                  // 渲染分卷
                  return (
                    <div key={item.key} className="px-6 py-3 bg-gray-50 border-l-2 border-[var(--primary)] group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="text-sm font-medium text-[var(--primary)]">{item.volume.title}</span>
                          <span className="text-xs text-[var(--muted)]">分卷</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditVolume(item.volume)}
                            className="p-1.5 text-[var(--muted)] hover:text-[var(--primary)] rounded-md transition-colors"
                            title="编辑分卷"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteVolume(item.volume.id)}
                            className="p-1.5 text-[var(--muted)] hover:text-red-500 rounded-md transition-colors"
                            title="删除分卷"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                // 渲染章节
                const ch = item as typeof novel.chapters[0];
                const chapterIdx = novel.chapters.findIndex(c => c.id === ch.id);
                return (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between px-6 py-3 hover:bg-[var(--accent)] transition-colors group"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-sm text-[var(--muted)] w-8 shrink-0">
                        {chapterIdx + 1}.
                      </span>
                      <Link
                        href={`/s/${slug}/novels/${nid}/read?chapter=${ch.id}`}
                        className="text-sm hover:text-[var(--primary)] transition-colors truncate"
                      >
                        {ch.title}
                      </Link>
                      <span className="text-xs text-[var(--muted)] shrink-0">
                        {formatWordCount(ch.word_count)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <Link
                        href={`/s/${slug}/novels/${nid}/chapters/${ch.id}/edit`}
                        className="p-1.5 text-[var(--muted)] hover:text-[var(--primary)] rounded-md transition-colors"
                        title="编辑章节"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </Link>
                      <button
                        onClick={() => handleDeleteChapter(ch.id)}
                        className="p-1.5 text-[var(--muted)] hover:text-red-500 rounded-md transition-colors"
                        title="删除章节"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 创建分卷弹层 */}
      {showVolumeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowVolumeModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-sm mx-4 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editingVolume ? "编辑分卷" : "创建分卷"}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">分卷名称</label>
                <input
                  type="text"
                  value={volumeTitle}
                  onChange={e => setVolumeTitle(e.target.value)}
                  placeholder="例如：第一章 异界重生"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">插入位置</label>
                <select
                  value={volumePosition}
                  onChange={e => setVolumePosition(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value={0}>小说开头</option>
                  {novel.chapters?.map((ch, idx) => (
                    <option key={ch.id} value={ch.id}>
                      第 {idx + 1} 章「{ch.title}」之后
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowVolumeModal(false)}
                className="px-4 py-2 text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveVolume}
                disabled={creating}
                className="mei-btn-primary"
              >
                {creating ? (editingVolume ? "更新中..." : "创建中...") : (editingVolume ? "更新" : "创建")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
