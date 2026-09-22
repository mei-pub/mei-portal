"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "@/components/Link";
import { useSite } from "@/components/SiteContext";
import SitePanel, { SiteGlyph } from "@/components/SitePanel";

// 书籍图标渲染：封面样式 > Logo 样式 > 默认首字母卡片（多样式同屏兼容）
function NovelThumb({ novel, size = "md" }: { novel: { title: string; cover_url?: string; icon?: string; icon_color?: string }; size?: "md" }) {
  const h = size === "md" ? "h-16 w-12" : "h-16 w-12";
  if (novel.cover_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={novel.cover_url} alt={novel.title} className={`${h} rounded-lg object-cover flex-shrink-0 shadow-sm`} />;
  }
  if (novel.icon && /^(https?:)?\//.test(novel.icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={novel.icon} alt={novel.title} className={`${h} rounded-lg object-contain flex-shrink-0 shadow-sm`} style={{ background: novel.icon_color || "var(--accent)" }} />;
  }
  if (novel.icon && novel.icon.includes(":")) {
    // iconify 名（站点/书籍未引入 iconify 运行时，渲染渐变底 + 首字母）
    return (
      <span className={`${h} rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm text-white font-bold text-lg`} style={{ background: novel.icon_color || "linear-gradient(135deg,#6366f1,#a855f7)" }}>
        {novel.title.slice(0, 1)}
      </span>
    );
  }
  if (novel.icon) {
    return <span className={`${h} rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm text-2xl`} style={{ background: novel.icon_color || "var(--accent)" }}>{novel.icon}</span>;
  }
  return (
    <span className={`${h} rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm text-white font-bold text-lg`} style={{ background: "linear-gradient(135deg,#6366f1,#a855f7)" }}>
      {novel.title.slice(0, 1)}
    </span>
  );
}

// FilterBar: 整合搜索、分类、标签、排序 - 协调设计
function FilterBar({
  categories, allTags, selectedCategory, selectedTag, sortBy, search, onSearch,
  onCategoryChange, onTagChange, onSortChange, onClearCategory, onClearTag,
}: {
  categories: string[]; allTags: string[]; selectedCategory: string; selectedTag: string; sortBy: "default" | "rating"; search: string; onSearch: (v: string) => void; 
  onCategoryChange: (cat: string) => void; onTagChange: (tag: string) => void;
  onSortChange: (sort: "default" | "rating") => void;
  onClearCategory: () => void; onClearTag: () => void;
}) {
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [categoryInput, setCategoryInput] = useState("");
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const categorySuggestions = useMemo(() => {
    if (!categoryInput.trim()) return categories;
    return categories.filter(c => c.toLowerCase().includes(categoryInput.trim().toLowerCase()));
  }, [categories, categoryInput]);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node) && !categoryInputRef.current?.contains(e.target as Node)) setShowCatDropdown(false);
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) setShowTagDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const hasFilter = selectedCategory || selectedTag || sortBy !== "default";

  return (
    <>
      {/* Desktop: 一体化筛选栏 */}
      <div className="hidden sm:flex items-center gap-2 p-3 bg-white border border-[var(--border)] rounded-2xl shadow-sm">
        {/* 排序组 */}
        <div className="flex items-center gap-1 px-3 py-2 bg-[var(--accent)] rounded-full">
          <button type="button" onClick={() => onSortChange("default")}
            className={`p-2 rounded-full transition-all ${sortBy === "default" ? "bg-white shadow text-[var(--foreground)]" : "text-[var(--muted)] hover:bg-white/50"}`} title="默认顺序">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <button type="button" onClick={() => onSortChange("rating")}
            className={`p-2 rounded-full transition-all ${sortBy === "rating" ? "bg-white shadow text-amber-500" : "text-[var(--muted)] hover:bg-white/50"}`} title="按评分排序">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </button>
        </div>

        {/* 分类下拉 */}
        <div ref={catDropdownRef} className="relative">
          <button type="button" onClick={() => setShowCatDropdown(!showCatDropdown)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-full border transition-all ${
              selectedCategory ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)] font-medium" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" /></svg>
            <span>{selectedCategory || "分类"}</span>
            {selectedCategory && (
              <span onClick={(e) => { e.stopPropagation(); onClearCategory(); }}
                className="ml-1 w-4 h-4 rounded-full bg-[var(--primary)] text-white text-xs flex items-center justify-center hover:bg-red-400">✕</span>
            )}
          </button>
          {showCatDropdown && (
            <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-[var(--border)] rounded-xl shadow-lg z-20 overflow-hidden">
              <div className="p-2 border-b border-[var(--border)]">
                <input ref={categoryInputRef} type="text" placeholder="搜索分类..." value={categoryInput}
                  onChange={e => setCategoryInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {categorySuggestions.length === 0 ? <div className="px-4 py-3 text-sm text-[var(--muted)] text-center">无匹配</div> :
                  categorySuggestions.map(cat => <button key={cat} onClick={() => { onCategoryChange(cat); setShowCatDropdown(false); setCategoryInput(""); }}
                    className={`w-full px-4 py-2.5 text-sm text-left rounded-lg hover:bg-[var(--accent)] ${selectedCategory === cat ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : ""}`}>{cat}</button>)}
              </div>
            </div>)}
        </div>

        {/* 标签下拉 */}
        <div ref={tagDropdownRef} className="relative">
          <button type="button" onClick={() => setShowTagDropdown(!showTagDropdown)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-full border transition-all ${selectedTag ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)] font-medium" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]/50 hover:text-[var(--foreground)]"}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
            <span>{selectedTag || "标签"}</span>
            {selectedTag && (
              <span onClick={(e) => { e.stopPropagation(); onClearTag(); }}
                className="ml-1 w-4 h-4 rounded-full bg-[var(--primary)] text-white text-xs flex items-center justify-center hover:bg-red-400">✕</span>
            )}
          </button>
          {showTagDropdown && (
            <div className="absolute top-full left-0 mt-2 w-48 bg-white border border-[var(--border)] rounded-xl shadow-lg z-20 max-h-56 overflow-y-auto p-1">
              {allTags.length === 0 ? <div className="px-4 py-3 text-sm text-[var(--muted)] text-center">无标签</div> :
                allTags.map(tag => <button key={tag} onClick={() => { onTagChange(tag); setShowTagDropdown(false); }}
                  className={`w-full px-4 py-2.5 text-sm text-left rounded-lg hover:bg-[var(--accent)] ${selectedTag === tag ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : ""}`}>{tag}</button>)}
            </div>)}
        </div>

        {/* 搜索框 */}
        <div className="relative flex-1 max-w-[240px] ml-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="搜索小说..." value={search} onChange={e => onSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-full border border-[var(--border)] bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent" />
        </div>
      </div>

      {/* Mobile: 胶囊筛选按钮 */}
      <div className="sm:hidden flex items-center gap-3">
        <button type="button" onClick={() => setShowFilterPanel(true)}
          className="flex items-center gap-2 px-5 py-3 text-sm rounded-full border border-[var(--border)] bg-white shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" /></svg>
          <span className="text-[var(--foreground)]">筛选</span>
          {hasFilter && <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>}
        </button>
        <div className="relative flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="搜索..." value={search} onChange={e => onSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-3 text-sm rounded-full border border-[var(--border)] bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
        </div>
      </div>

      {/* Mobile Filter Panel */}
      {showFilterPanel && (
        <div className="sm:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setShowFilterPanel(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4"></div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-xl text-[var(--foreground)]">筛选</h3>
              <button onClick={() => setShowFilterPanel(false)} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-[var(--muted)] hover:bg-gray-200">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-5">
              {/* 排序 */}
              <div>
                <label className="block text-sm font-medium text-[var(--muted)] mb-3">排序</label>
                <div className="flex gap-3">
                  <button onClick={() => onSortChange("default")} className={`flex-1 py-4 text-sm rounded-2xl flex items-center justify-center gap-2 font-medium transition-all ${sortBy === "default" ? "bg-[var(--foreground)] text-white shadow-md" : "bg-gray-100 text-[var(--muted)] hover:bg-gray-200"}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>默认
                  </button>
                  <button onClick={() => onSortChange("rating")} className={`flex-1 py-4 text-sm rounded-2xl flex items-center justify-center gap-2 font-medium transition-all ${sortBy === "rating" ? "bg-amber-500 text-white shadow-md" : "bg-gray-100 text-[var(--muted)] hover:bg-gray-200"}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>评分
                  </button>
                </div>
              </div>
              {/* 分类 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[var(--muted)]">分类</label>
                  {selectedCategory && <button onClick={onClearCategory} className="text-xs text-[var(--primary)] font-medium hover:underline">清除</button>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => <button key={cat} onClick={() => onCategoryChange(cat)}
                    className={`px-5 py-2.5 text-sm rounded-full font-medium transition-all ${selectedCategory === cat ? "bg-[var(--primary)] text-white shadow-md" : "bg-gray-100 text-[var(--muted)] hover:bg-gray-200"}`}>{cat}</button>)}
                </div>
              </div>
              {/* 标签 */}
              {allTags.length > 0 && <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-[var(--muted)]">标签</label>
                  {selectedTag && <button onClick={onClearTag} className="text-xs text-[var(--primary)] font-medium hover:underline">清除</button>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => <button key={tag} onClick={() => onTagChange(tag)}
                    className={`px-5 py-2.5 text-sm rounded-full font-medium transition-all ${selectedTag === tag ? "bg-[var(--primary)] text-white shadow-md" : "bg-gray-100 text-[var(--muted)] hover:bg-gray-200"}`}>{tag}</button>)}
                </div>
              </div>}
              {/* 确认按钮 */}
              <button onClick={() => setShowFilterPanel(false)} className="mei-btn-primary">
                应用筛选
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
  updated_at: string;
}

export default function HomePage() {
  const site = useSite();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "rating">("rating");

  useEffect(() => { fetchNovels(); }, []);

  async function fetchNovels() {
    try {
      const res = await fetch("/novels/api/novels");
      if (!res.ok) {
        console.error("Failed to fetch novels:", res.status);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setNovels(data);
      }
    } catch (err) { console.error("Failed to fetch novels:", err); }
    finally { setLoading(false); }
  }

  function formatWordCount(count: number) {
    if (count >= 10000) return (count / 10000).toFixed(1) + "万字";
    return count + "字";
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    (novels || []).forEach(n => { if (n.category) set.add(n.category); });
    return Array.from(set).sort();
  }, [novels]);

  const tabCategories = useMemo(() => categories.slice(0, 9), [categories]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (novels || []).forEach(n => { (n.tags || []).forEach(t => set.add(t)); });
    return Array.from(set).sort();
  }, [novels]);

  const filtered = useMemo(() => {
    const arr = novels || [];
    let result = arr.filter(n => {
      const matchSearch = n.title.toLowerCase().includes(search.toLowerCase()) || n.author.toLowerCase().includes(search.toLowerCase());
      const matchCategory = !selectedCategory || n.category === selectedCategory;
      const matchTag = !selectedTag || (n.tags || []).includes(selectedTag);
      return matchSearch && matchCategory && matchTag;
    });
    if (sortBy === "rating") result = [...result].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return result;
  }, [novels, search, selectedCategory, selectedTag, sortBy]);

  function getBadgeType(rating: number): "masterpiece" | "good" | "classic" | null {
    if (rating >= 9) return "masterpiece";
    if (rating >= 8) return "good";
    if (rating >= 7) return "classic";
    return null;
  }

  return (
    <>
      {/* 左侧站点面板：站点信息 + 站点/切换站点/添加（与书籍/章节页共享） */}
      <SitePanel />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-4 sm:pt-6 pb-6">
        {/* 站点信息横幅：对齐工具箱首页品牌渲染（Logo + 渐变名称居中，描述为副标题） */}
        <div className="mb-5 mt-2 flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <SiteGlyph icon={site.icon} color={site.iconColor} size={44} />
            <h1 className="text-[28px] sm:text-[34px] font-extrabold tracking-tight bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent flex items-center gap-2">
              {site.name}
              {site.type === "secret" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 align-middle" style={{ WebkitTextFillColor: "initial" }}>隐秘</span>}
            </h1>
          </div>
          {site.description && <p className="text-[13px] text-[var(--muted)] mt-1.5 max-w-xl line-clamp-2">{site.description}</p>}
        </div>
        <div className="mb-6">
          <FilterBar categories={categories} allTags={allTags} selectedCategory={selectedCategory} selectedTag={selectedTag} sortBy={sortBy} search={search} onSearch={setSearch}
            onCategoryChange={setSelectedCategory} onTagChange={setSelectedTag} onSortChange={setSortBy}
            onClearCategory={() => setSelectedCategory("")} onClearTag={() => setSelectedTag("")} />
        </div>
        {(selectedCategory || selectedTag) && (
          <div className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)] flex-wrap">
            {selectedCategory && (<><span>分类：</span><span className="px-3 py-0.5 bg-[var(--accent)] text-[var(--primary)] rounded-full font-medium">{selectedCategory}</span>
              <button onClick={() => setSelectedCategory("")} className="text-[var(--muted)] hover:text-red-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></>)}
            {selectedTag && (<><span>标签：</span><span className="px-3 py-0.5 bg-[var(--accent)] text-[var(--primary)] rounded-full font-medium">{selectedTag}</span>
              <button onClick={() => setSelectedTag("")} className="text-[var(--muted)] hover:text-red-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></>)}
            <span className="text-xs">（共 {filtered.length} 本）</span>
          </div>
        )}
        {loading ? (<div className="text-center py-20 text-[var(--muted)]">加载中...</div>) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-[var(--border)] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            <p className="text-[var(--muted)] mb-4">{search || selectedCategory || selectedTag ? "没有找到匹配的小说" : "书架空空如也，添加第一本小说吧"}</p>
            {!search && <Link href={`/s/${site.slug}/novels/new`} prefetch={false} className="mei-btn-primary">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>添加小说</Link>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(novel => {
              const badgeType = getBadgeType(novel.rating || 0);
              return (
              <Link key={novel.id} href={`/s/${site.slug}/novels/${novel.slug || novel.id}`} prefetch={false}
                className="flex gap-3 bg-white rounded-2xl border border-[var(--border)] p-3 hover:shadow-md hover:border-[var(--primary)] transition-all cursor-pointer relative overflow-hidden">
                <NovelThumb novel={novel} />
                {badgeType && (
                  <div className={`absolute bottom-0 right-0 px-2 py-0.5 text-xs font-bold text-white rounded-tl-lg ${
                    badgeType === "masterpiece" ? "bg-gradient-to-r from-amber-500 to-red-500" :
                    badgeType === "good" ? "bg-gradient-to-r from-emerald-500 to-teal-500" :
                    "bg-gradient-to-r from-purple-600 to-pink-500"
                  }`}>
                    {badgeType === "masterpiece" ? "神作" : badgeType === "good" ? "佳作" : "经典"}
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate pr-2">{novel.title}</h3>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{novel.author || "未知作者"}</p>
                  </div>
                  <span className={`shrink-0 text-xs ${novel.status === "completed" ? "text-green-500" : "text-orange-400"}`}>{novel.status === "completed" ? "已完结" : "连载中"}</span>
                </div>
                {(novel.category || (novel.tags && novel.tags.length > 0)) && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {novel.category && <span className="px-1.5 py-0.5 bg-[var(--accent)] rounded text-xs">{novel.category}</span>}
                    {(novel.tags || []).slice(0, 2).map(tag => <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-[var(--muted)]">{tag}</span>)}
                  </div>
                )}
              </Link>);
            })}
          </div>
        )}
      </main>
    </>
  );
}
