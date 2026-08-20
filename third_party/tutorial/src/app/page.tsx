"use client";

// 小说阅读 · 站点选择页
// 展示普通站点 + 已开启的隐秘站点；隐秘站点通过门户首页搜索框
// open:{标识}:{密码} 开启后在此可见（或直接从站点路径输入密码进入）
import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";

interface SiteEntry {
  slug: string;
  name: string;
  type: "normal" | "secret";
}

export default function SitesPage() {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/novels/api/sites")
      .then((r) => r.json())
      .then((data) => setSites(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">小说阅读</h1>
            <p className="text-sm text-[var(--muted)] mt-1">选择一个小说站点进入阅读</p>
          </div>
          <Link
            href="/manage"
            className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
          >
            站点管理
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-20 text-[var(--muted)]">加载中...</div>
        ) : sites.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[var(--muted)] mb-2">暂无站点</p>
            <p className="text-xs text-[var(--muted)]">
              到「站点管理」创建一个小说站点；隐秘站点需在首页搜索框输入 open:标识:密码 开启
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sites.map((site) => (
              <Link
                key={site.slug}
                href={`/s/${site.slug}`}
                className="flex items-center gap-4 bg-white rounded-2xl border border-[var(--border)] p-5 hover:shadow-md hover:border-[var(--primary)] transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--foreground)] truncate">{site.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">/{site.slug} · {site.type === "secret" ? "隐秘站点" : "普通站点"}</div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--muted)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
