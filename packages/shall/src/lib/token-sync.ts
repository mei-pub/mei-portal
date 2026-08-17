// 子应用 token 同步：把 /api/auth/me 返回的 token 类应用凭证写入 localStorage
// 设置集成页在挂载 iframe 前调用（嵌入模式不注入 topbar.js，需自行保证登录态）
// 各 key/形状与子应用前端一致：
//   sun-panel → AUTH_TOKEN            {token}
//   mediago   → appstore-storage      {state:{...扁平字段, apiKey}, version}（zustand persist）
//   ai-draw   → auth-storage          {state:{user, token}, version}

interface AuthMe {
  loggedIn?: boolean;
  tokens?: Record<string, string>;
}

function mergeJson(key: string, mutate: (parsed: Record<string, unknown>) => void) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
    mutate(parsed);
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    // localStorage 不可用或旧值损坏时忽略
  }
}

export async function syncAppTokens(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const d = (await res.json()) as AuthMe;
    if (!d.loggedIn || !d.tokens) return;

    if (d.tokens['sun-panel']) {
      mergeJson('AUTH_TOKEN', (p) => {
        p.token = d.tokens!['sun-panel'];
      });
    }
    if (d.tokens['mediago']) {
      mergeJson('appstore-storage', (p) => {
        const state = (p.state && typeof p.state === 'object' ? p.state : {}) as Record<string, unknown>;
        state.apiKey = d.tokens!['mediago'];
        p.state = state;
        if (typeof p.version !== 'number') p.version = 0;
      });
    }
    if (d.tokens['ai-draw']) {
      mergeJson('auth-storage', (p) => {
        const state = (p.state && typeof p.state === 'object' ? p.state : {}) as Record<string, unknown>;
        state.token = d.tokens!['ai-draw'];
        if (!state.user) state.user = { username: 'admin', role: 'admin' };
        p.state = state;
        if (typeof p.version !== 'number') p.version = 0;
      });
    }
  } catch {
    // 网络异常时静默（iframe 内应用会自行处理未登录态）
  }
}
