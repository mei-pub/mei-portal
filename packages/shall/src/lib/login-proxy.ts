// 各应用登录适配器：Shell 登录时并发代理登录，收集各应用 set-cookie 透传给浏览器
// 同源共享 cookie，浏览器访问各应用子路径时自动带上 session
// 新增应用 = 加一个适配器到 ADAPTERS

export interface AppLoginResult {
  appId: string;
  success: boolean;
  cookies: string[]; // 透传给浏览器的 Set-Cookie 值
}

interface AppLoginAdapter {
  appId: string;
  /** 调用应用登录接口，返回需 set 给浏览器的 cookie */
  login: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; cookies: string[] }>;
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

// tutorial：nginx 已注入 auth-token cookie，无需适配器

const ADAPTERS: AppLoginAdapter[] = [meilinkAdapter, lunatvAdapter];

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
