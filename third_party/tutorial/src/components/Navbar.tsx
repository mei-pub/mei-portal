"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSite } from "@/components/SiteContext";

/**
 * 小说阅读 Navbar
 * 站点页内（/s/{slug}/*）：品牌区显示站点名，首页/添加链接到当前站点；
 * 全局页（站点列表/管理/游戏中心）：品牌区显示「小说阅读」，链接到站点列表。
 */
export default function Navbar() {
  const pathname = usePathname();
  const site = useSite();
  const inSite = !!site.slug;
  const homeHref = inSite ? `/s/${site.slug}` : "/";
  const newHref = inSite ? `/s/${site.slug}/novels/new` : "/";
  const isReader = pathname.includes("/read");
  if (isReader) return null;
  return (
    <nav className="bg-white border-b border-[var(--border)] sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link href={homeHref} className="flex items-center gap-2 text-lg font-bold text-[var(--primary)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            {inSite ? site.name : "小说阅读"}
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className={`p-2 rounded-lg transition-colors ${pathname === "/" ? "bg-[var(--accent)] text-[var(--primary)]" : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-gray-100"}`} title="站点列表">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </Link>
            {inSite && (
              <Link href={newHref} className={`p-2 rounded-lg transition-colors ${pathname.endsWith("/novels/new") ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-gray-100"}`} title="添加">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
