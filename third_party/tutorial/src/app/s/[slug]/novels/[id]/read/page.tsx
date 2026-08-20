"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import MarkdownRenderer from "@/components/MarkdownRenderer";

// Prevent default touch behaviors for better mobile reading experience
if (typeof document !== "undefined") {
  let lastTouchDistance = 0;
  document.addEventListener("touchmove", (e: TouchEvent) => {
    // Prevent pinch-zoom (2+ touch points)
    if (e.touches.length >= 2) {
      e.preventDefault();
    }
  }, { passive: false });
}

interface Chapter {
  id: number;
  title: string;
  chapter_order: number;
}

interface ChapterContent {
  id: number;
  title: string;
  content: string;
}

type FullTextMode = "off" | "lazy" | "parallel";

interface ReaderSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: "light" | "sepia" | "dark";
  fullTextMode: FullTextMode;
}

interface FontConfig {
  label: string;
  value: string;
  webFontFamily?: string;
  desc?: string;
}

const FONTS: FontConfig[] = [
  { label: "系统默认", value: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  { label: "思源宋体", value: "'Noto Serif SC', 'SimSun', 'STSong', serif", webFontFamily: "Noto Serif SC", desc: "经典衬线，适合长文" },
  { label: "思源黑体", value: "'Noto Sans SC', 'SimHei', 'STHeiti', sans-serif", webFontFamily: "Noto Sans SC", desc: "清晰无衬线" },
  { label: "霞鹜文楷", value: "'LXGW WenKai', 'KaiTi', 'STKaiti', serif", webFontFamily: "LXGW WenKai", desc: "手写楷体，阅读舒适" },
  { label: "马善政楷", value: "'Ma Shan Zheng', serif", webFontFamily: "Ma Shan Zheng", desc: "毛笔楷书" },
  { label: "站酷小薇", value: "'ZCOOL XiaoWei', serif", webFontFamily: "ZCOOL XiaoWei", desc: "文艺宋体" },
  { label: "站酷快乐", value: "'ZCOOL KuaiLe', sans-serif", webFontFamily: "ZCOOL KuaiLe", desc: "圆润可爱" },
  { label: "站酷庆科", value: "'ZCOOL QingKe HuangYou', sans-serif", webFontFamily: "ZCOOL QingKe HuangYou", desc: "艺术手写" },
  { label: "龙藏体", value: "'Long Cang', serif", webFontFamily: "Long Cang", desc: "行书手写" },
  { label: "志芒行书", value: "'Zhi Mang Xing', serif", webFontFamily: "Zhi Mang Xing", desc: "草书行书" },
  { label: "刘建毛草", value: "'Liu Jian Mao Cao', serif", webFontFamily: "Liu Jian Mao Cao", desc: "草书手写" },
];

const THEMES = {
  light: { bg: "#ffffff", text: "#333333", name: "默认白" },
  sepia: { bg: "#f5efdc", text: "#5b4636", name: "护眼黄" },
  dark: { bg: "#1a1a2e", text: "#e0e0e0", name: "夜间" },
};

const FULLTEXT_LABELS: Record<FullTextMode, string> = {
  off: "单章",
  lazy: "全文(懒加载)",
  parallel: "全文(预加载)",
};

export default function ReaderPage() {
  const params = useParams();
  const slug = params.slug as string;
  const searchParams = useSearchParams();
  const router = useRouter();
  const novelId = params.id as string;

  // 沉浸式阅读：隐藏门户注入顶栏（卸载时恢复）
  useEffect(() => {
    const bar = document.getElementById("mei-topbar");
    if (bar) bar.style.display = "none";
    return () => {
      const b = document.getElementById("mei-topbar");
      if (b) b.style.display = "";
    };
  }, []);
  const chapterIdParam = searchParams.get("chapter");
  const fulltextParam = searchParams.get("fulltext");

  const [novelTitle, setNovelTitle] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<ChapterContent | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Full-text mode state
  const [loadedChapters, setLoadedChapters] = useState<Map<number, ChapterContent>>(new Map());
  const [lazyLoadedUpTo, setLazyLoadedUpTo] = useState(-1); // for lazy mode

  // Reader settings
  const [settings, setSettings] = useState<ReaderSettings>({
    fontFamily: FONTS[0].value,
    fontSize: 18,
    lineHeight: 1.8,
    theme: "light",
    fullTextMode: "off",
  });

  const contentRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showChapterList, setShowChapterList] = useState(false);
  const [showBars, setShowBars] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<{ time: number; x: number; side: "left" | "right" | "center" }>({ time: 0, x: 0, side: "center" });
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // ── Font loading state ──
  const [fontStatusMap, setFontStatusMap] = useState<Map<string, "available" | "downloading" | "need-download">>(new Map());
  const [fontDownloadProgress, setFontDownloadProgress] = useState<string | null>(null);
  const loadedFontLinksRef = useRef<Set<string>>(new Set());

  // Load settings from localStorage, then apply URL override
  useEffect(() => {
    const saved = localStorage.getItem("reader-settings");
    let parsed: Partial<ReaderSettings> = {};
    if (saved) {
      try { parsed = JSON.parse(saved); } catch {}
    }
    // Migrate legacy font values to new names
    if (parsed.fontFamily) {
      const migrations: Record<string, string> = {
        "'SimSun', 'STSong', serif": FONTS.find(f => f.label === "思源宋体")?.value!,
        "'KaiTi', 'STKaiti', serif": FONTS.find(f => f.label === "霞鹜文楷")?.value!,
        "'SimHei', 'STHeiti', 'Heiti SC', sans-serif": FONTS.find(f => f.label === "思源黑体")?.value!,
        "'FangSong', 'STFangsong', serif": FONTS[0].value, // 仿宋 → 回退到系统默认
        "'Microsoft YaHei', 'PingFang SC', sans-serif": FONTS.find(f => f.label === "思源黑体")?.value!,
      };
      if (migrations[parsed.fontFamily]) {
        parsed.fontFamily = migrations[parsed.fontFamily];
      }
    }
    // URL param fulltext=parallel|lazy overrides saved setting
    if (fulltextParam === "parallel" || fulltextParam === "lazy") {
      parsed.fullTextMode = fulltextParam;
    }
    setSettings(prev => ({ ...prev, ...parsed, flipMode: undefined }));
  }, []);

  // Save settings to localStorage
  useEffect(() => {
    const { flipMode: _, ...rest } = settings as any;
    localStorage.setItem("reader-settings", JSON.stringify(rest));
  }, [settings]);

  // ── Font loading helpers ──
  const getDownloadedFonts = useCallback((): Set<string> => {
    try {
      const saved = localStorage.getItem("downloaded-fonts");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  }, []);

  const markFontDownloaded = useCallback((label: string) => {
    const set = getDownloadedFonts();
    set.add(label);
    localStorage.setItem("downloaded-fonts", JSON.stringify([...set]));
  }, [getDownloadedFonts]);

  const injectFontLink = useCallback((family: string): Promise<void> => {
    const url = `/api/fonts?family=${encodeURIComponent(family)}`;
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") { resolve(); return; }
      if (loadedFontLinksRef.current.has(family)) { resolve(); return; }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = () => {
        loadedFontLinksRef.current.add(family);
        resolve();
      };
      link.onerror = () => reject(new Error(`Failed to load font: ${family}`));
      document.head.appendChild(link);
      // Timeout: large fonts may take long on first server-side download
      setTimeout(() => { resolve(); }, 120000);
    });
  }, []);

  const downloadAndApplyFont = useCallback(async (font: FontConfig) => {
    if (!font.webFontFamily) return;
    setFontStatusMap(prev => new Map(prev).set(font.label, "downloading"));
    setFontDownloadProgress(font.label);

    try {
      await injectFontLink(font.webFontFamily);
      await new Promise(r => setTimeout(r, 300));
      await document.fonts.load(`16px "${font.webFontFamily}"`);
      await document.fonts.ready;
      markFontDownloaded(font.label);
      setFontStatusMap(prev => new Map(prev).set(font.label, "available"));
    } catch (err) {
      console.error(`Failed to load font ${font.label}:`, err);
      setFontStatusMap(prev => new Map(prev).set(font.label, "need-download"));
    }
    setFontDownloadProgress(null);
  }, [injectFontLink, markFontDownloaded]);

  // Init font statuses: system default = available, others = check localStorage
  useEffect(() => {
    const downloaded = getDownloadedFonts();
    const newMap = new Map<string, "available" | "downloading" | "need-download">();
    for (const font of FONTS) {
      if (!font.webFontFamily) {
        newMap.set(font.label, "available");
      } else {
        newMap.set(font.label, downloaded.has(font.label) ? "available" : "need-download");
      }
    }
    setFontStatusMap(newMap);
  }, [getDownloadedFonts]);

  // Auto-restore previously downloaded font for current selection
  useEffect(() => {
    const currentFont = FONTS.find(f => f.value === settings.fontFamily);
    if (!currentFont?.webFontFamily) return;
    const status = fontStatusMap.get(currentFont.label);
    if (status === "available") {
      // Font was downloaded before, re-inject the CSS so it applies immediately
      injectFontLink(currentFont.webFontFamily);
    }
  }, [fontStatusMap, settings.fontFamily, injectFontLink]);

  // Handle font selection
  const handleFontSelect = useCallback(async (font: FontConfig) => {
    const status = fontStatusMap.get(font.label);

    if (!font.webFontFamily) {
      // System default or system-only font
      setSettings(prev => ({ ...prev, fontFamily: font.value }));
      return;
    }

    if (status === "available") {
      setSettings(prev => ({ ...prev, fontFamily: font.value }));
    } else if (status === "downloading") {
      // Already downloading
    } else {
      // Need download — confirm first
      const confirmed = window.confirm(
        `「${font.label}」字体尚未下载，需要从网络下载字体文件。\n字体文件较大，建议在 WiFi 环境下下载。\n\n是否立即下载？`
      );
      if (!confirmed) return;

      await downloadAndApplyFont(font);
      // Download succeeded → apply
      const newStatus = fontStatusMap.get(font.label);
      if (newStatus === "available") {
        setSettings(prev => ({ ...prev, fontFamily: font.value }));
      }
    }
  }, [fontStatusMap, downloadAndApplyFont]);

  // Sync reader CSS variables for mobile font size priority
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--reader-font-size", settings.fontSize + "px");
    root.style.setProperty("--reader-line-height", String(settings.lineHeight));
    root.style.setProperty("--reader-font-family", settings.fontFamily);
  }, [settings]);

  // Fetch chapters list
  useEffect(() => {
    async function fetchChapters() {
      try {
        const novelRes = await fetch(`/novels/api/novels/${novelId}`);
        if (novelRes.ok) {
          const novelData = await novelRes.json();
          setNovelTitle(novelData.title);
          if (novelData.chapters) {
            setChapters(novelData.chapters);
          }
        }
      } catch (err) {
        console.error("Failed to fetch chapters:", err);
      }
    }
    fetchChapters();
  }, [novelId]);

  // Load single chapter content (when fullTextMode is off)
  useEffect(() => {
    if (settings.fullTextMode !== "off" || chapters.length === 0) {
      // If no chapters, mark loading done so empty state can show
      if (chapters.length === 0 && settings.fullTextMode === "off") {
        setLoading(false);
      }
      return;
    }
    async function loadChapter() {
      setLoading(true);
      let targetId = chapterIdParam ? parseInt(chapterIdParam) : chapters[0]?.id;
      const idx = chapters.findIndex(c => c.id === targetId);
      setCurrentChapterIndex(idx >= 0 ? idx : 0);
      if (idx < 0 && chapters.length > 0) targetId = chapters[0].id;
      try {
        const res = await fetch(`/novels/api/chapters/${targetId}`);
        if (res.ok) {
          const data = await res.json();
          setCurrentChapter({ id: data.id, title: data.title, content: data.content || "" });
        }
      } catch (err) {
        console.error("Failed to load chapter:", err);
      } finally {
        setLoading(false);
        // Scroll to top when chapter content loads
        setTimeout(() => {
          const container = scrollContainerRef.current;
          if (container) container.scrollTop = 0;
        }, 50);
      }
    }
    loadChapter();
  }, [chapters, chapterIdParam, settings.fullTextMode]);

  // ── Full-text: Parallel pre-load all chapters ──
  useEffect(() => {
    if (settings.fullTextMode !== "parallel" || chapters.length === 0) return;
    setLoading(true);
    const newMap = new Map<number, ChapterContent>();
    let loaded = 0;
    // Load chapters in order, with controlled concurrency (3 at a time)
    const concurrency = 3;
    let nextIdx = 0;

    function loadNext(): Promise<void> {
      if (nextIdx >= chapters.length) return Promise.resolve();
      const idx = nextIdx++;
      const ch = chapters[idx];
      return fetch(`/novels/api/chapters/${ch.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            newMap.set(idx, { id: data.id, title: data.title, content: data.content || "" });
          }
          loaded++;
          if (loaded === chapters.length) {
            setLoadedChapters(new Map(newMap));
            setLoading(false);
          }
          return loadNext(); // chain next
        });
    }

    const starters = Array.from({ length: Math.min(concurrency, chapters.length) }, () => loadNext());
    Promise.all(starters).catch(() => setLoading(false));
  }, [chapters, settings.fullTextMode]);

  // ── Full-text: Lazy load — start from current chapter, load on scroll ──
  useEffect(() => {
    if (settings.fullTextMode !== "lazy" || chapters.length === 0) return;
    setLoading(true);
    setLoadedChapters(new Map());
    setLazyLoadedUpTo(-1);

    // Load initial chapter
    let startIdx = 0;
    if (chapterIdParam) {
      const found = chapters.findIndex(c => c.id === parseInt(chapterIdParam));
      if (found >= 0) startIdx = found;
    }

    async function loadFrom(startIdx: number) {
      const newMap = new Map<number, ChapterContent>();
      // Load first 3 chapters starting from startIdx
      for (let i = startIdx; i < Math.min(startIdx + 3, chapters.length); i++) {
        try {
          const res = await fetch(`/novels/api/chapters/${chapters[i].id}`);
          if (res.ok) {
            const data = await res.json();
            newMap.set(i, { id: data.id, title: data.title, content: data.content || "" });
          }
        } catch {}
      }
      setLoadedChapters(newMap);
      setLazyLoadedUpTo(Math.min(startIdx + 2, chapters.length - 1));
      setLoading(false);

      // Scroll to the starting chapter
      setTimeout(() => {
        const el = document.getElementById(`chapter-${startIdx}`);
        if (el) el.scrollIntoView({ behavior: "auto" });
      }, 100);
    }
    loadFrom(startIdx);
  }, [chapters, chapterIdParam, settings.fullTextMode]);

  // ── Lazy load: IntersectionObserver to load more chapters ──
  useEffect(() => {
    if (settings.fullTextMode !== "lazy" || chapters.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const idx = parseInt((entry.target as HTMLElement).dataset.loadIdx || "0");
            loadMoreLazy(idx);
          }
        });
      },
      { root: container, rootMargin: "400px" }
    );

    // Observe sentinel elements at the bottom
    const sentinels = container.querySelectorAll("[data-load-idx]");
    sentinels.forEach(s => observer.observe(s));

    return () => observer.disconnect();
  }, [loadedChapters, chapters, settings.fullTextMode]);

  async function loadMoreLazy(fromIdx: number) {
    // Load 2 more chapters ahead
    for (let i = fromIdx + 1; i < Math.min(fromIdx + 3, chapters.length); i++) {
      if (loadedChapters.has(i)) continue;
      try {
        const res = await fetch(`/novels/api/chapters/${chapters[i].id}`);
        if (res.ok) {
          const data = await res.json();
          setLoadedChapters(prev => {
            const newMap = new Map(prev);
            newMap.set(i, { id: data.id, title: data.title, content: data.content || "" });
            return newMap;
          });
          setLazyLoadedUpTo(i);
        }
      } catch {}
    }
  }

  // ── Auto-hide bars on scroll ──
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let lastScrollTop = container.scrollTop;
    let hiding = false;
    function onScroll() {
      if (!container) return;
      const st = container.scrollTop;
      const delta = st - lastScrollTop;
      if (delta > 10 && !hiding) { hiding = true; setShowBars(false); }
      else if (delta < -10 && hiding) { hiding = false; setShowBars(true); }
      if (st <= 0) { hiding = false; setShowBars(true); }
      lastScrollTop = st;
    }
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // ── Touch event handlers for iOS compatibility ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch || !touchStartRef.current) return;

    const start = touchStartRef.current;
    const deltaX = Math.abs(touch.clientX - start.x);
    const deltaY = Math.abs(touch.clientY - start.y);
    const deltaTime = Date.now() - start.time;

    // Only treat as tap if movement is small (< 10px) and time is short (< 500ms)
    if (deltaX < 10 && deltaY < 10 && deltaTime < 500) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = (touch.clientX - rect.left) / rect.width;
      const now = Date.now();
      let side: "left" | "right" | "center";
      if (relX < 0.4) side = "left";
      else if (relX > 0.6) side = "right";
      else side = "center";

      const last = lastTapRef.current;
      if (now - last.time < 350 && last.side === side) {
        // Double tap
        const container = scrollContainerRef.current;
        if (container) {
          const scrollAmount = container.clientHeight * 0.85;
          if (side === "left") {
            container.scrollBy({ top: -scrollAmount, behavior: "smooth" });
          } else if (side === "right") {
            container.scrollBy({ top: scrollAmount, behavior: "smooth" });
          }
        }
        lastTapRef.current = { time: 0, x: touch.clientX, side };
      } else if (side === "center") {
        setShowBars(prev => !prev);
        lastTapRef.current = { time: now, x: touch.clientX, side };
      } else {
        lastTapRef.current = { time: now, x: touch.clientX, side };
      }
    }
    touchStartRef.current = null;
  }, []);

  // ── Click handler for desktop/non-touch devices ──
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const clientX = e.clientX;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const now = Date.now();
    let side: "left" | "right" | "center";
    if (relX < 0.4) side = "left";
    else if (relX > 0.6) side = "right";
    else side = "center";

    const last = lastTapRef.current;
    if (now - last.time < 350 && last.side === side) {
      const container = scrollContainerRef.current;
      if (container) {
        const scrollAmount = container.clientHeight * 0.85;
        if (side === "left") {
          container.scrollBy({ top: -scrollAmount, behavior: "smooth" });
        } else if (side === "right") {
          container.scrollBy({ top: scrollAmount, behavior: "smooth" });
        }
      }
      lastTapRef.current = { time: 0, x: clientX, side };
    } else if (side === "center") {
      setShowBars(prev => !prev);
      lastTapRef.current = { time: now, x: clientX, side };
    } else {
      lastTapRef.current = { time: now, x: clientX, side };
    }
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;

      // ESC → back to novel detail page (chapter list)
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(`/s/${slug}/novels/${novelId}`);
        return;
      }

      const isFullText = settings.fullTextMode !== "off";
      const container = scrollContainerRef.current;

      // ── Scroll mode (always scroll now) ──
      if (isFullText) {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
          e.preventDefault();
          container?.scrollBy({ top: -(window.innerHeight * 0.8), behavior: "smooth" });
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
          e.preventDefault();
          container?.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
        } else if (e.key === "Home") {
          e.preventDefault();
          container?.scrollTo({ top: 0, behavior: "smooth" });
        } else if (e.key === "End") {
          e.preventDefault();
          container?.scrollTo({ top: container?.scrollHeight || 0, behavior: "smooth" });
        }
        return;
      }

      // Single chapter scroll
      if (e.key === "ArrowLeft") {
        e.preventDefault(); goPrevChapter();
      } else if (e.key === "ArrowRight") {
        e.preventDefault(); goNextChapter();
      } else if (e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault();
        container?.scrollBy({ top: -(window.innerHeight * 0.8), behavior: "smooth" });
      } else if (e.key === "PageDown" || e.key === "ArrowDown" || e.key === " ") {
        // Check if scrolled to bottom → next chapter
        if (container && Math.abs(container.scrollTop + container.clientHeight - container.scrollHeight) < 5) {
          e.preventDefault();
          goNextChapter();
        } else {
          e.preventDefault();
          container?.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        container?.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.key === "End") {
        e.preventDefault();
        container?.scrollTo({ top: container?.scrollHeight || 0, behavior: "smooth" });
      }
    },
    [settings.fullTextMode, chapters, currentChapterIndex]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function goNextChapter() {
    if (currentChapterIndex < chapters.length - 1) {
      router.push(`/s/${slug}/novels/${novelId}/read?chapter=${chapters[currentChapterIndex + 1].id}`);
    }
  }
  function goPrevChapter() {
    if (currentChapterIndex > 0) {
      router.push(`/s/${slug}/novels/${novelId}/read?chapter=${chapters[currentChapterIndex - 1].id}`);
    }
  }
  function jumpToChapter(chapterId: number) {
    setShowChapterList(false);
    if (settings.fullTextMode !== "off") {
      const el = document.getElementById(`chapter-${chapters.findIndex(c => c.id === chapterId)}`);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    } else {
      router.push(`/s/${slug}/novels/${novelId}/read?chapter=${chapterId}`);
    }
  }

  const theme = THEMES[settings.theme];
  const isFullText = settings.fullTextMode !== "off";

  const noChapters = !loading && chapters.length === 0;

  if (loading && !currentChapter && loadedChapters.size === 0 && !noChapters) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: theme.bg }}>
        <p style={{ color: theme.text }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: theme.bg, color: theme.text }}>
      {/* Top Bar */}
      <div className={`shrink-0 border-b px-4 py-2 flex items-center justify-between text-sm transition-all duration-300 ${showBars ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 h-0 py-0 overflow-hidden"}`}
        style={{ background: theme.bg, borderColor: theme.text + "20" }}>
        <Link href={`/s/${slug}/novels/${novelId}`} className="flex items-center gap-1 hover:opacity-70 transition-opacity" style={{ color: theme.text }}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </Link>
        <span className="truncate max-w-[200px] font-medium">
          {isFullText ? novelTitle : currentChapter?.title}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowChapterList(!showChapterList)}
            className="px-2 py-1 text-xs rounded border hover:opacity-70 transition-opacity"
            style={{ borderColor: theme.text + "30", color: theme.text }}>
            目录
          </button>
          <button onClick={() => setShowSettings(!showSettings)}
            className="px-2 py-1 text-xs rounded border hover:opacity-70 transition-opacity"
            style={{ borderColor: theme.text + "30", color: theme.text }}>
            设置
          </button>
        </div>
      </div>

      {/* Main Content — single scrollbar, touch-enabled */}
      <div
        className="flex-1 overflow-y-auto overscroll-y-contain"
        ref={scrollContainerRef}
        onClick={handleContentClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { touchStartRef.current = null; }}
      >
        {/* No chapters */}
        {noChapters && (
          <div className="max-w-3xl mx-auto px-6 py-20 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} style={{ color: theme.text }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-lg opacity-50 mb-2" style={{ color: theme.text }}>暂无可阅读内容</p>
            <p className="text-sm opacity-30" style={{ color: theme.text }}>请先添加章节或导入全文</p>
          </div>
        )}

        {/* Full-text mode: all chapters in one scroll */}
        {isFullText && !noChapters && (
          <div className="max-w-3xl mx-auto px-6 py-8">
            {Array.from({ length: chapters.length }).map((_, idx) => {
              const ch = loadedChapters.get(idx);
              return (
                <div key={idx} id={`chapter-${idx}`} className="mb-12">
                  {ch ? (
                    <>
                      <h2 className="text-xl font-bold mb-6 text-center border-b pb-3" style={{ borderColor: theme.text + "15" }}>
                        {ch.title}
                      </h2>
                      <MarkdownRenderer
                        content={ch.content}
                        className="reader-content"
                        textStyle={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize + "px", lineHeight: settings.lineHeight }}
                      />
                    </>
                  ) : (
                    // Lazy loading sentinel
                    <div data-load-idx={idx} className="text-center py-8 opacity-30 text-sm">
                      {idx <= lazyLoadedUpTo ? "加载中..." : ""}
                    </div>
                  )}
                </div>
              );
            })}
            {loadedChapters.size >= chapters.length && (
              <div className="text-center py-8 text-sm opacity-40">— 全书完 —</div>
            )}
          </div>
        )}

        {/* Single chapter: Scroll Mode (always) */}
        {!isFullText && currentChapter && (
          <div ref={contentRef} className="max-w-3xl mx-auto px-6 py-8">
            <h2 className="text-xl font-bold mb-6 text-center">{currentChapter.title}</h2>
            <MarkdownRenderer
              content={currentChapter.content}
              className="reader-content"
              textStyle={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize + "px", lineHeight: settings.lineHeight }}
            />
            <div className="text-center py-8 text-sm opacity-50">
              {currentChapterIndex === chapters.length - 1 ? "已是最后一章" : ""}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className={`shrink-0 flex items-center justify-between px-4 py-2 border-t text-sm transition-all duration-300 ${showBars ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 h-0 py-0 overflow-hidden"}`}
        style={{ borderColor: theme.text + "20", background: theme.bg }}>
          <button onClick={goPrevChapter} disabled={currentChapterIndex <= 0}
            className="px-3 py-1 rounded border disabled:opacity-30 hover:opacity-70 transition-opacity"
            style={{ borderColor: theme.text + "30", color: theme.text }}>
            上一章
          </button>
          <span className="text-xs opacity-50">{currentChapterIndex + 1} / {chapters.length}</span>
          <button onClick={goNextChapter} disabled={currentChapterIndex >= chapters.length - 1}
            className="px-3 py-1 rounded border disabled:opacity-30 hover:opacity-70 transition-opacity"
            style={{ borderColor: theme.text + "30", color: theme.text }}>
            下一章
          </button>
      </div>

      {/* Settings Panel：z-index 压过门户注入顶栏（10000），沉浸式覆盖全屏 */}
      {showSettings && (
        <div className="fixed inset-0 z-[10100] flex items-end justify-center" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-lg rounded-t-xl shadow-xl flex flex-col max-h-[70vh]"
            style={{ background: theme.bg }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0 border-b" style={{ borderColor: theme.text + "15" }}>
              <h3 className="font-semibold text-sm">阅读设置</h3>
              <button onClick={() => setShowSettings(false)} className="w-7 h-7 flex items-center justify-center rounded-full opacity-50 hover:opacity-100 text-base">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1 overscroll-contain">
            {/* Font Family */}
            <div>
              <label className="text-sm font-medium mb-2 block">字体</label>
              <div className="grid grid-cols-2 gap-2">
                {FONTS.map(f => {
                  const status = fontStatusMap.get(f.label);
                  const isActive = settings.fontFamily === f.value;
                  const isDownloading = status === "downloading" || fontDownloadProgress === f.label;
                  const needsDownload = status === "need-download";

                  return (
                    <button key={f.label} onClick={() => handleFontSelect(f)}
                      disabled={isDownloading}
                      className={`px-3 py-2 text-xs rounded border transition-colors flex items-center justify-between gap-1 text-left ${isDownloading ? "opacity-60 cursor-wait" : ""}`}
                      style={{ borderColor: isActive ? "#4f46e5" : theme.text + "30", color: isActive ? "#4f46e5" : theme.text, background: isActive ? "#4f46e510" : "transparent" }}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium">{f.label}</span>
                        {f.desc && <span className="text-[10px] opacity-40 truncate">{f.desc}</span>}
                      </div>
                      {isDownloading ? (
                        <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : needsDownload ? (
                        <svg className="h-3.5 w-3.5 shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      ) : status === "available" && f.webFontFamily ? (
                        <svg className="h-3.5 w-3.5 shrink-0 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {fontDownloadProgress && (
                <div className="mt-2 flex items-center gap-2 text-xs opacity-60">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>正在下载「{fontDownloadProgress}」字体文件，请稍候...</span>
                </div>
              )}
              <p className="text-[10px] mt-1 opacity-30">带下载图标的字体需联网下载，下载后可离线使用</p>
            </div>
            {/* Font Size */}
            <div>
              <label className="text-sm font-medium mb-2 block">字号: {settings.fontSize}px</label>
              <input type="range" min={12} max={32} value={settings.fontSize}
                onChange={e => setSettings({ ...settings, fontSize: parseInt(e.target.value) })} className="w-full accent-[var(--primary)]" />
            </div>
            {/* Line Height */}
            <div>
              <label className="text-sm font-medium mb-2 block">行间距: {settings.lineHeight.toFixed(1)}</label>
              <input type="range" min={1.0} max={3.0} step={0.1} value={settings.lineHeight}
                onChange={e => setSettings({ ...settings, lineHeight: parseFloat(e.target.value) })} className="w-full accent-[var(--primary)]" />
            </div>
            {/* Full-text mode */}
            <div>
              <label className="text-sm font-medium mb-2 block">阅读模式</label>
              <div className="flex gap-2">
                {([{ value: "off" as FullTextMode, label: "单章" }, { value: "lazy" as FullTextMode, label: "全文(懒加载)" }, { value: "parallel" as FullTextMode, label: "全文(预加载)" }]).map(m => (
                  <button key={m.value} onClick={() => setSettings({ ...settings, fullTextMode: m.value })}
                    className="px-3 py-1.5 text-xs rounded border transition-colors"
                    style={{ borderColor: settings.fullTextMode === m.value ? "#4f46e5" : theme.text + "30", color: settings.fullTextMode === m.value ? "#4f46e5" : theme.text }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] mt-1 opacity-40">
                {settings.fullTextMode === "lazy" ? "滚动到末尾自动加载下一章" : settings.fullTextMode === "parallel" ? "同时下载所有章节，按顺序显示" : "逐章阅读"}
              </p>
            </div>
            {/* Theme */}
            <div>
              <label className="text-sm font-medium mb-2 block">主题</label>
              <div className="flex gap-2">
                {(Object.entries(THEMES) as [keyof typeof THEMES, typeof THEMES[keyof typeof THEMES]][]).map(([key, t]) => (
                  <button key={key} onClick={() => setSettings({ ...settings, theme: key })}
                    className={`w-10 h-10 rounded-lg border-2 transition-all ${settings.theme === key ? "scale-110" : "border-transparent"}`}
                    style={{ background: t.bg, borderColor: settings.theme === key ? "#4f46e5" : "transparent" }} title={t.name} />
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Chapter List Panel：同设置面板，覆盖门户顶栏 */}
      {showChapterList && (
        <div className="fixed inset-0 z-[10100] flex items-end justify-center" onClick={() => setShowChapterList(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-lg rounded-t-xl shadow-xl max-h-[60vh] overflow-hidden flex flex-col"
            style={{ background: theme.bg }} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: theme.text + "20" }}>
              <h3 className="font-semibold text-sm">{novelTitle} - 目录</h3>
              <button onClick={() => setShowChapterList(false)} className="text-lg opacity-50 hover:opacity-100">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {chapters.map((ch, i) => (
                <button key={ch.id} onClick={() => jumpToChapter(ch.id)}
                  className="w-full text-left px-5 py-2.5 text-sm hover:opacity-70 transition-opacity border-b"
                  style={{ borderColor: theme.text + "10", color: currentChapter?.id === ch.id ? "#4f46e5" : theme.text, fontWeight: currentChapter?.id === ch.id ? 600 : 400 }}>
                  {i + 1}. {ch.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
