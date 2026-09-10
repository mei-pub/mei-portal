// HTTP 抓取封装 —— Go util/http_util.go 的 TS 对应物
// Node 全局 fetch + 超时/UA/重试。Go 版的连接池/SOCKS 代理在事件循环下不需要；
// PROXY 支持通过 undici ProxyAgent 未引入依赖，暂以直连实现（与部署形态一致）。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  redirect?: RequestRedirect;
  method?: string;
  body?: string;
  /** 响应体最多读取的字节数（超出即取消下载），0/未设置 = 不限制 */
  maxBodyBytes?: number;
}

/** 抓取文本（HTML/JSON），带超时 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { ...DEFAULT_HEADERS, ...opts.headers },
      redirect: opts.redirect ?? 'follow',
      body: opts.body,
      signal: controller.signal,
    });
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 有限读取响应体：达到 maxBodyBytes 即取消下载（链接检查等只需页头片段的场景） */
async function readBodyCapped(resp: Response, maxBodyBytes: number): Promise<string> {
  if (!(maxBodyBytes > 0)) return resp.text();
  const reader = resp.body?.getReader();
  if (!reader) return resp.text();
  const decoder = new TextDecoder();
  let out = '';
  let received = 0;
  try {
    while (received < maxBodyBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    if (received >= maxBodyBytes) reader.cancel().catch(() => {});
  }
  return out;
}

/** 抓取并返回状态码与重定向后的最终 URL（链接检查用） */
export async function fetchProbe(
  url: string,
  opts: FetchOptions = {},
): Promise<{ status: number; finalUrl: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { ...DEFAULT_HEADERS, ...opts.headers },
      redirect: opts.redirect ?? 'follow',
      body: opts.body,
      signal: controller.signal,
    });
    // 链接检查只需要开头片段判断失效特征，避免整页下载
    const text = await readBodyCapped(resp, opts.maxBodyBytes ?? 0);
    return { status: resp.status, finalUrl: resp.url, body: text };
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的抓取（指数退避，默认 3 次） */
export async function fetchTextWithRetry(url: string, opts: FetchOptions = {}, retries = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchText(url, opts);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** t.me 网页版搜索 URL（Go BuildSearchURL） */
export function buildSearchURL(channel: string, keyword: string, nextPageParam = ''): string {
  let base = `https://t.me/s/${channel}`;
  if (keyword !== '') {
    base += `?q=${encodeURIComponent(keyword)}`;
    if (nextPageParam !== '') base += `&${nextPageParam}`;
  }
  return base;
}

/** 简易并发限制器（替代 Go worker pool；事件循环下只控制在途请求数） */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

/**
 * 硬 deadline race：deadlineMs 内 promise 未决则返回 onDeadline() 的兜底值。
 * 用途：所有软超时（fetch abort / 快窗）都靠 setTimeout，事件循环被外发抓取
 * 风暴压住时会集体迟到；deadline 兜底保证响应时间有硬上界，慢源只损失完整度。
 * - promise 先决 → 返回其结果（正常路径，零额外等待）
 * - deadline 先决 → 返回 onDeadline()；promise 继续在后台跑，其 rejection 由
 *   race 挂接的处理器消化，不会成为 unhandledRejection
 * - 定时器 unref：不阻塞进程退出
 */
export async function withDeadline<T>(promise: Promise<T>, deadlineMs: number, onDeadline: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timedOut = new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), deadlineMs);
      timer.unref();
    });
    const winner = await Promise.race([promise.then(() => false as const), timedOut]);
    if (winner) return onDeadline();
    return await promise;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
