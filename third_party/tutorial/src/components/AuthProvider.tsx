"use client";
import { useEffect, useState, useCallback, createContext, useContext } from "react";
import LibraryGate from "./LibraryGate";

interface LibraryInfo {
  id: number;
  name: string;
  hidden?: number;
  hasPassword?: boolean;
  created_at: string;
  updated_at: string;
}
interface AuthContextType {
  authenticated: boolean;
  libraryId: number | null;
  libraryName: string;
  libraries: LibraryInfo[];
  loading: boolean;
  login: (libraryId: number, password: string) => Promise<boolean>;
  logout: () => void;
  hide: () => void;
}
const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  libraryId: null,
  libraryName: "小说书架",
  libraries: [],
  loading: true,
  login: async () => false,
  logout: () => {},
  hide: () => {},
});
export function useAuth() {
  return useContext(AuthContext);
}

// ── Authenticated fetch wrapper: intercepts 401 and forces hide ──
let forceHideFn: (() => void) | null = null;
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    forceHideFn?.();
  }
  return res;
}

// URL ?lib=N 目标书架（门户书架卡片/顶栏书架面板深链）
function readTargetLib(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get("lib");
    if (!v || !/^\d+$/.test(v)) return null;
    return parseInt(v, 10);
  } catch {
    return null;
  }
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [libraryName, setLibraryName] = useState("小说书架");
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [targetLibId, setTargetLibId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const forceHide = useCallback(() => {
    setAuthenticated(false);
  }, []);

  useEffect(() => {
    forceHideFn = forceHide;
    // Install global fetch interceptor for 401 responses
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const res = await originalFetch.apply(this, args);
      if (res.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] instanceof Request ? args[0].url : String(args[0])));
        if (url.startsWith('/api/') || url.includes('/api/')) {
          /* mei: 移除死循环 reload */ forceHideFn?.();
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
      forceHideFn = null;
    };
  }, [forceHide]);

  async function login(libId: number, password: string): Promise<boolean> {
    try {
      const res = await fetch("/novels/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId: libId, password }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuthenticated(true);
        setLibraryId(data.libraryId);
        setLibraryName(data.libraryName || "小说书架");
        return true;
      }
    } catch {}
    return false;
  }

  // 主密码解锁（解锁 ≠ 打开）：解锁后隐藏书架出现在列表中
  async function unlockMaster(password: string): Promise<boolean> {
    try {
      const res = await fetch("/novels/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setUnlocked(true);
        // 重新拉取书架列表（隐藏书架现在可见）
        const sr = await fetch("/novels/api/settings");
        if (sr.ok) {
          const data = await sr.json();
          setLibraries(data.libraries || []);
        }
        return true;
      }
    } catch {}
    return false;
  }

  useEffect(() => {
    async function check() {
      const target = readTargetLib();
      setTargetLibId(target);
      try {
        const res = await fetch("/novels/api/settings");
        if (res.status === 401) {
          setLibraries([]);
          setAuthenticated(false);
        } else if (res.ok) {
          const data = await res.json();
          const libs: LibraryInfo[] = data.libraries || [];
          setLibraries(libs);
          setUnlocked(!!data.unlocked);
          // If no libraries exist, show main app (first-time setup)
          if (libs.length === 0) {
            setAuthenticated(true);
          } else if (target !== null && target !== data.authenticatedLibraryId) {
            // mei-allin：?lib=N 深链 —— 目标书架与当前 cookie 书架不一致时切换。
            // 无密码书架静默切换；有密码则落到门控页（预选目标书架，就地输密码）
            const ok = await login(target, "");
            if (!ok) setAuthenticated(false);
          } else if (data.authenticatedLibraryId) {
            // Already authenticated via cookie
            setAuthenticated(true);
            setLibraryId(data.authenticatedLibraryId);
            const lib = libs.find((l: LibraryInfo) => l.id === data.authenticatedLibraryId);
            setLibraryName(lib?.name || "小说书架");
          } else {
            // Not authenticated: show library gate
            setAuthenticated(false);
          }
        } else {
          // Other error, show main app
          setAuthenticated(true);
        }
      } catch {
        // Network error, show main app
        setAuthenticated(true);
      } finally {
        setLoading(false);
      }
    }
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    setAuthenticated(false);
    setLibraryId(null);
    try {
      await fetch("/novels/api/auth/login", { method: "DELETE" });
    } catch {}
  }
  async function hide() {
    setAuthenticated(false);
    setLibraryId(null);
    // mei-allin：门户伪装开关已移除，隐藏书架由设置集成页「小说书架管理」统一管理
    try {
      await fetch("/novels/api/auth/login", { method: "DELETE" });
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="text-[var(--muted)] text-sm">加载中...</p>
      </div>
    );
  }
  // mei-allin：未认证时展示书架门控页（替代原蜘蛛纸牌伪装页）
  if (!authenticated && libraries.length > 0) {
    return (
      <LibraryGate
        libraries={libraries}
        unlocked={unlocked}
        targetLibId={targetLibId}
        onLogin={login}
        onUnlockMaster={unlockMaster}
      />
    );
  }
  return (
    <AuthContext.Provider value={{ authenticated, libraryId, libraryName, libraries, loading, login, logout, hide }}>
      {children}
    </AuthContext.Provider>
  );
}
