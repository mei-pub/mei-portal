// 各应用登录适配器：Shell 登录时并发代理登录，收集各应用 set-cookie 透传给浏览器
// 同源共享 cookie，浏览器访问各应用子路径时自动带上 session
// 新增应用 = 加一个适配器到 ADAPTERS

export interface AppLoginResult {
  appId: string;
  success: boolean;
  cookies: string[]; // 透传给浏览器的 Set-Cookie 值
  token?: string; // token 类应用的凭证（如 sun-panel）
}

interface AppLoginAdapter {
  appId: string;
  /** 调用应用登录接口，返回需 set 给浏览器的 cookie 和/或 token */
  login: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; cookies: string[]; token?: string }>;
}

// 从 fetch 响应提取所有 Set-Cookie（Node 20+ 支持 getSetCookie）
function extractSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*\w+=)/) : [];
}

// ----- mei-link 适配器 -----
const meilinkAdapter: AppLoginAdapter = {
  appId: 'mei-link',
  async login(username, password) {
    try {
      const res = await fetch('http://127.0.0.1:3002/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: username, password }),
      });
      return { success: res.ok, cookies: extractSetCookies(res) };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- lunatv 适配器（单密码模式）-----
const lunatvAdapter: AppLoginAdapter = {
  appId: 'lunatv',
  async login(_username, password) {
    try {
      const res = await fetch('http://127.0.0.1:3003/tv/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      return { success: res.ok, cookies: extractSetCookies(res) };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- solara 适配器（单密码 cookie auth）-----
const solaraAdapter: AppLoginAdapter = {
  appId: 'solara',
  async login(_username, password) {
    try {
      const res = await fetch('http://127.0.0.1:3005/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      return { success: res.ok, cookies: extractSetCookies(res) };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- sun-panel 适配器（token header + localStorage，默认 admin@sun.cc/12345678）-----
// sun-panel 不支持 env 初始化，用默认凭据登录拿 token
// token 通过 /api/auth/me 返回给前端，顶栏 JS 注入 localStorage
const sunpanelAdapter: AppLoginAdapter = {
  appId: 'sun-panel',
  async login() {
    try {
      const res = await fetch('http://127.0.0.1:3006/panel/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin@sun.cc', password: '12345678' }),
      });
      const data = await res.json();
      const token = data?.data?.token;
      if (token) {
        return { success: true, cookies: [], token };
      }
      return { success: false, cookies: [] };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- mediago 适配器（API key + localStorage）-----
const mediagoAdapter: AppLoginAdapter = {
  appId: 'mediago',
  async login(_u, password) {
    try {
      const res = await fetch('http://127.0.0.1:3000/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      const apiKey = data?.data;
      if (apiKey) {
        return { success: true, cookies: [], token: apiKey };
      }
      return { success: false, cookies: [] };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- ai-draw 适配器（JWT Bearer + localStorage auth-storage）-----
// admin 用户密码用 MEI_ADMIN_PASSWORD（patch 改造后），token 存 localStorage["auth-storage"]
// zustand-persist 格式：{state: {user, token}, version: 0}
// 直接调 Express（127.0.0.1:3004/api/auth/login），不走 nginx（无需 /draw 前缀）
const aidrawAdapter: AppLoginAdapter = {
  appId: 'ai-draw',
  async login(username, password) {
    try {
      const res = await fetch('http://127.0.0.1:3004/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username || 'admin', password }),
      });
      if (!res.ok) return { success: false, cookies: [] };
      const data = await res.json();
      const token = data?.token;
      if (token) {
        return { success: true, cookies: [], token };
      }
      return { success: false, cookies: [] };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

// ----- tutorial 主密码自动解锁 -----
// 书架主密码未单独配置（MEI_HIDDEN_LIBRARY_PASSWORD 缺省回落 MEI_ADMIN_PASSWORD）时，
// 门户登录即解锁书架管理（unlock=0，解锁≠打开），免去重复输入同一个密码；
// 单独配置了主密码则跳过，保留手动解锁作为有意义的第二层验证。
// 注：tutorial 构建时带 basePath=/novels，直连 3001 需带前缀
const tutorialUnlockAdapter: AppLoginAdapter = {
  appId: 'tutorial',
  async login(_u, password) {
    if (process.env.MEI_HIDDEN_LIBRARY_PASSWORD) {
      return { success: true, cookies: [] }; // 主密码独立：不自动解锁
    }
    try {
      const res = await fetch('http://127.0.0.1:3001/novels/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      return { success: res.ok, cookies: extractSetCookies(res) };
    } catch {
      return { success: false, cookies: [] };
    }
  },
};

const ADAPTERS: AppLoginAdapter[] = [meilinkAdapter, lunatvAdapter, solaraAdapter, sunpanelAdapter, mediagoAdapter, aidrawAdapter, tutorialUnlockAdapter];

/** 并发代理登录所有已注册应用 */
export async function proxyLoginAll(
  username: string,
  password: string
): Promise<AppLoginResult[]> {
  return Promise.all(
    ADAPTERS.map(async (a) => {
      try {
        const r = await a.login(username, password);
        return { appId: a.appId, ...r };
      } catch {
        return { appId: a.appId, success: false, cookies: [] };
      }
    })
  );
}
