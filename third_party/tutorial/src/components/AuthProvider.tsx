"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import SpiderSolitaire from "./SpiderSolitaire";

interface LibraryInfo {
  id: number;
  name: string;
  hidden?: number;
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

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [libraryName, setLibraryName] = useState("小说书架");
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAnyPassword, setHasAnyPassword] = useState(false);

  const forceHide = useCallback(() => {
    setAuthenticated(false);
  }, []);

  useEffect(() => {
    forceHideFn = forceHide;
    // Install global fetch interceptor for 401 responses
    // On any API 401, force re-check auth by reloading
    const originalFetch = window.fetch;
    window.fetch = async function(...args: Parameters<typeof fetch>) {
      const res = await originalFetch.apply(this, args);
      if (res.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] instanceof Request ? args[0].url : String(args[0])));
        if (url.startsWith('/api/') || url.includes('/api/')) {
          forceHideFn?.();
          // Reload to re-check authentication
          /* mei: 移除死循环 reload */ forceHideFn && forceHideFn();
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
      forceHideFn = null;
    };
  }, [forceHide]);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/novels/api/settings");
        if (res.status === 401) {
          // Not authenticated via any library
          const libs: LibraryInfo[] = [];
          setLibraries(libs);
          setAuthenticated(false);
          setHasAnyPassword(true);
        } else if (res.ok) {
          const data = await res.json();
          const libs: LibraryInfo[] = data.libraries || [];
          setLibraries(libs);

          // If no libraries exist, show main app (first-time setup)
          if (libs.length === 0) {
            setAuthenticated(true);
            setHasAnyPassword(false);
          } else if (data.authenticatedLibraryId) {
            // Already authenticated via cookie
            setAuthenticated(true);
            setLibraryId(data.authenticatedLibraryId);
            const lib = libs.find((l: LibraryInfo) => l.id === data.authenticatedLibraryId);
            setLibraryName(lib?.name || "小说书架");
          } else {
            // Not authenticated: immediately hide to show spider solitaire
            setAuthenticated(false);
            setHasAnyPassword(true);
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
  }, []);

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

  // Handle nickname from Spider Solitaire "new game"
  // Send nickname to backend; if it matches any library password, auto-login
  async function handleGameNickname(nickname: string) {
    try {
      const res = await fetch("/novels/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.matched && data.success) {
          setAuthenticated(true);
          setLibraryId(data.libraryId);
          setLibraryName(data.libraryName || "小说书架");
        }
        // If not matched, the game just continues normally as a game nickname
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="text-[var(--muted)] text-sm">加载中...</p>
      </div>
    );
  }

  // Show Spider Solitaire as disguise when not authenticated and libraries exist
  if (!authenticated && libraries.length > 0) {
    return <SpiderSolitaire onNewGameNickname={handleGameNickname} />;
  }

  return (
    <AuthContext.Provider value={{ authenticated, libraryId, libraryName, libraries, loading, login, logout, hide }}>
      {children}
    </AuthContext.Provider>
  );
}
