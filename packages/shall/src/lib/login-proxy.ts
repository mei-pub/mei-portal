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

// tutorial：nginx 已注入 auth-token cookie，无需适配器

const ADAPTERS: AppLoginAdapter[] = [meilinkAdapter, lunatvAdapter, solaraAdapter, sunpanelAdapter];

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
