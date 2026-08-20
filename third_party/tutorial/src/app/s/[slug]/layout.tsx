"use client";

// 小说站点布局：解析站点标识（slug）→ 校验可访问性 → 注入站点上下文
// - 普通站点：直接可访问
// - 隐秘站点未开启：展示密码门控（输入开启密码 → /novels/api/gate open）
// - 内容 API 拦截器：/novels/api/* 请求自动附加 ?site={slug}（服务端据此鉴权）
import { createContext, useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteContext, type SiteInfo } from "@/components/SiteContext";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = params.slug as string;
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "gate" | "notfound">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 内容 API 自动附加 site 参数（站点作用域鉴权）
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (raw.startsWith("/novels/api/") && !raw.startsWith("/novels/api/sites") && !raw.startsWith("/novels/api/gate") && !raw.startsWith("/novels/api/auth")) {
          const sep = raw.includes("?") ? "&" : "?";
          const url = `${raw}${sep}site=${encodeURIComponent(slug)}`;
          return originalFetch(new Request(url, typeof input === "string" || input instanceof URL ? undefined : input), init);
        }
      } catch {}
      return originalFetch(input as RequestInfo, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [slug]);

  useEffect(() => {
    setStatus("loading");
    fetch(`/novels/api/sites/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) { setStatus("notfound"); return; }
        const data = await res.json();
        setSite({ slug: data.slug, name: data.name, type: data.type, icon: data.icon || "", iconColor: data.iconColor || "", description: data.description || "" });
        setStatus(data.accessible ? "ok" : "gate");
      })
      .catch(() => setStatus("notfound"));
  }, [slug]);

  async function openSite(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/novels/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", slug, password }),
      });
      if (res.ok) {
        setStatus("ok");
        setPassword("");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "开启失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="text-[var(--muted)] text-sm">加载中...</p>
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] gap-3">
        <p className="text-[var(--foreground)] font-medium">站点不存在或已关闭</p>
        <a href="/novels" className="text-sm text-[var(--primary)] hover:underline">返回站点列表</a>
      </div>
    );
  }

  if (status === "gate" && site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm bg-[var(--card-bg)] border border-[var(--border)] rounded-2xl shadow-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--foreground)]">{site.name}</h1>
              <p className="text-xs text-[var(--muted)]">隐秘站点 · 输入开启密码进入</p>
            </div>
          </div>
          <form onSubmit={openSite} className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="开启密码"
              autoFocus
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <button
              type="submit"
              disabled={busy || !password}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
            >
              开启
            </button>
          </form>
          {error && <p className="mt-3 text-xs text-red-500 text-center">{error}</p>}
          <a href="/novels" className="block mt-4 text-xs text-[var(--muted)] hover:text-[var(--foreground)] text-center transition-colors">
            返回站点列表
          </a>
        </div>
      </div>
    );
  }

  return (
    <SiteContext.Provider value={site!}>
      {children}
    </SiteContext.Provider>
  );
}
