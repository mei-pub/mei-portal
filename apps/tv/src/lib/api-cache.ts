/**
 * 服务端内存缓存（LRU + TTL + 在途请求去重）。
 * 自托管部署无 CDN，路由里设置的 s-maxage 形同虚设；上游（豆瓣 / Bangumi）
 * 每次实时抓取是影视门户页面打开慢的主因。这里做进程级缓存：
 * - 命中：同参数重复请求零耗时（首页回切、浏览页筛选回退秒开）
 * - 在途去重：首屏并发同 URL 只打上游一次
 * - 失败不缓存：上游抖动时下次请求自动重试
 */
interface CacheEntry {
  value: unknown;
  expires: number;
}

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
export const MAX_CACHE_ENTRIES = 300;

export async function cachedFetchJson<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    // LRU touch：命中后移到末尾，避免热点数据被挤出
    store.delete(key);
    store.set(key, hit);
    return hit.value as T;
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const task = (async () => {
    const value = await loader();
    if (store.size >= MAX_CACHE_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  })();
  inflight.set(key, task);
  try {
    return (await task) as T;
  } finally {
    inflight.delete(key);
  }
}

/** 测试与运维用：清空全部缓存 */
export function clearApiCache(): void {
  store.clear();
  inflight.clear();
}

/** 当前缓存条目数（测试用） */
export function apiCacheSize(): number {
  return store.size;
}
