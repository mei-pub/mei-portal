"use client";

// 站点浮动面板（小说站点各页共享）：站点信息 + 站点 / 切换站点 / 添加
// 风格对齐主站门户：毛玻璃、圆角、渐变强调
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSite } from "@/components/SiteContext";

interface SiteEntry {
  slug: string;
  name: string;
  type: "normal" | "secret";
  icon?: string;
  iconColor?: string;
  description?: string;
}

export function SiteGlyph({ icon, color, size = 20 }: { icon?: string; color?: string; size?: number }) {
  const c = color || "var(--primary)";
  if (icon && /^(https?:)?\//.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" style={{ width: size, height: size, borderRadius: size / 4, objectFit: "cover" }} />;
  }
  if (icon && icon.includes(":")) {
    return <span style={{ width: size, height: size, borderRadius: size / 4, background: c, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: size * 0.55, fontWeight: 700 }}>书</span>;
  }
  if (icon) {
    return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: size / 4, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    </span>
  );
}

export default function SitePanel() {
  const site = useSite();
  const [open, setOpen] = useState<boolean | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [others, setOthers] = useState<SiteEntry[] | null>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("mei-float-novels") !== "1");
    } catch { setOpen(true); }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem("mei-float-novels", next ? "0" : "1"); } catch {}
  };

  function loadOthers() {
    if (others !== null) return;
    fetch("/novels/api/sites")
      .then((r) => r.json())
      .then((list: SiteEntry[]) => setOthers((Array.isArray(list) ? list : []).filter((s) => s.slug !== site.slug)))
      .catch(() => setOthers([]));
  }

  if (open === null) return null;

  if (!open) {
    return (
      <button onClick={() => toggle(true)} title="展开站点面板"
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 h-16 w-6 flex items-center justify-center rounded-r-xl bg-gradient-to-b from-indigo-500 to-purple-500 text-white shadow-lg transition-all hover:w-8">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>
      </button>
    );
  }

  return (
    <div className="fixed left-2.5 top-1/2 -translate-y-1/2 z-40 w-44 rounded-2xl bg-white/85 backdrop-blur-md border border-[var(--border)] shadow-lg overflow-hidden">
      {/* 站点信息（继承图标项属性渲染） */}
      <div className="px-3 pt-3 pb-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <SiteGlyph icon={site.icon} color={site.iconColor} size={30} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--foreground)] truncate">{site.name}</div>
            <div className="text-[10px] text-[var(--muted)] truncate">/{site.slug} · {site.type === "secret" ? "隐秘站点" : "普通站点"}</div>
          </div>
        </div>
        {site.description && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)] line-clamp-2">{site.description}</p>
        )}
      </div>

      {/* 操作项 */}
      <div className="p-1.5">
        <Link href={`/s/${site.slug}`} className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-[12.5px] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
          站点
        </Link>
        <button
          onClick={() => { setSwitchOpen(!switchOpen); loadOthers(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-[12.5px] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
          切换站点
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`ml-auto text-[var(--muted)] transition-transform ${switchOpen ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6"/></svg>
        </button>
        {switchOpen && (
          <div className="mt-1 mb-1 rounded-xl bg-gray-50 border border-[var(--border)] overflow-hidden">
            {others === null ? (
              <p className="px-3 py-2.5 text-[11px] text-[var(--muted)]">加载中...</p>
            ) : others.length === 0 ? (
              <p className="px-3 py-2.5 text-[11px] text-[var(--muted)]">没有其他站点可以切换</p>
            ) : (
              others.map((s) => (
                <Link key={s.slug} href={`/s/${s.slug}`} className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
                  <SiteGlyph icon={s.icon} color={s.iconColor} size={16} />
                  <span className="truncate">{s.name}</span>
                  {s.type === "secret" && <span className="ml-auto text-[9px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-600 flex-shrink-0">隐</span>}
                </Link>
              ))
            )}
          </div>
        )}
        <Link href={`/s/${site.slug}/novels/new`} className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-[12.5px] text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]"><path d="M12 5v14M5 12h14"/></svg>
          添加
        </Link>
      </div>

      <button onClick={() => toggle(false)} title="收起"
        className="w-full py-1.5 flex items-center justify-center text-[var(--muted)] hover:bg-[var(--accent)] transition-colors border-t border-[var(--border)]">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
      </button>
    </div>
  );
}
