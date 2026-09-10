// 插件基座 —— Go plugin/plugin.go BaseAsyncPlugin 异步语义的 Node 事件循环版
// 核心行为（与 Go 完全一致）：
//   1. 插件级内存缓存（键 name:keyword，TTL=ASYNC_CACHE_TTL_HOURS）：有效直接返回，
//      超过 80% TTL 后台刷新；已过期但有结果 → 返回旧值 + 后台刷新
//   2. 4s（ASYNC_RESPONSE_TIMEOUT）快速响应：Promise.race，超时返回部分缓存或空结果
//   3. 后台继续完成 → 与旧缓存按 unique_id 合并（新结果优先）→ 写主缓存（最终结果）
// Go 的 worker pool / 快慢双客户端 / channel 编排在事件循环下天然不需要。

import { config } from '../config.ts';
import { cache } from '../cache.ts';
import { mergeSearchResults } from '../merge.ts';
import type { SearchPlugin, SearchResult } from '../types.ts';

interface PluginCacheEntry {
  results: SearchResult[];
  timestamp: number;
  complete: boolean;
}

/** 插件级内存缓存（Go apiResponseCache：仅内存，不持久化） */
const pluginCache = new Map<string, PluginCacheEntry>();

function pluginCacheTTL(): number {
  return config.asyncCacheTTLHours * 60 * 60 * 1000;
}

/** 执行一次插件搜索（Service 层唯一入口，Go plugin.Search 的对应物） */
export async function runPluginSearch(
  plugin: SearchPlugin,
  keyword: string,
  ext: Record<string, unknown>,
  mainCacheKey: string,
): Promise<SearchResult[]> {
  const cacheKey = `${plugin.name}:${keyword}`;
  const ttl = pluginCacheTTL();
  const forceRefresh = ext['refresh'] === true;
  const now = Date.now();

  const runSearch = () => plugin.search(keyword, ext);

  if (!forceRefresh) {
    const cached = pluginCache.get(cacheKey);
    if (cached) {
      const age = now - cached.timestamp;
      // 完全有效（未过期且完整）
      if (age < ttl && cached.complete) {
        // 接近过期（>80% TTL）后台刷新
        if (age > (ttl * 4) / 5) void refreshInBackground();
        return cached.results;
      }
      // 已过期但有结果：返回旧值，后台刷新
      if (cached.results.length > 0) {
        if (age >= ttl) void refreshInBackground();
        return cached.results;
      }
    }
  }

  const searchPromise = runSearch();

  // 4s 快速响应窗口
  const fastWindow = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), config.asyncResponseTimeoutSeconds * 1000));

  const winner = await Promise.race([searchPromise.then((r) => r as SearchResult[] | 'timeout'), fastWindow]);

  if (winner !== 'timeout') {
    const results = winner;
    pluginCache.set(cacheKey, { results, timestamp: Date.now(), complete: true });
    // 主缓存：读旧 → 合并 → 两级写（isFinal=true）
    cache.updateMerged(mainCacheKey, results, config.cacheTTLMinutes * 60 * 1000, mergeSearchResults);
    return results;
  }

  // 响应超时：返回部分缓存（若有），否则空结果；后台继续补全
  const partial = pluginCache.get(cacheKey);
  if (partial && partial.results.length > 0) {
    return partial.results;
  }
  pluginCache.set(cacheKey, { results: [], timestamp: Date.now(), complete: false });
  // 空结果也回写主缓存（Go：4s 超时也更新主缓存，标记部分结果）
  cache.updateMerged(mainCacheKey, [], config.cacheTTLMinutes * 60 * 1000, mergeSearchResults);

  // 后台继续：完成后合并旧缓存、写回主缓存（不 await）
  searchPromise
    .then((results) => {
      const old = pluginCache.get(cacheKey);
      let merged = results;
      if (old && old.results.length > 0) {
        const existingIDs = new Set(results.map((r) => r.unique_id));
        merged = [...results, ...old.results.filter((r) => !existingIDs.has(r.unique_id))];
      }
      pluginCache.set(cacheKey, { results: merged, timestamp: Date.now(), complete: true });
      cache.updateMerged(mainCacheKey, merged, config.cacheTTLMinutes * 60 * 1000, mergeSearchResults);
    })
    .catch((err) => {
      console.error(`[plugin:${plugin.name}] 后台搜索失败: ${err instanceof Error ? err.message : err}`);
    });

  return [];

  /** 后台刷新缓存（缓存接近过期/已过期时） */
  async function refreshInBackground(): Promise<void> {
    try {
      const results = await runSearch();
      pluginCache.set(cacheKey, { results, timestamp: Date.now(), complete: true });
      cache.updateMerged(mainCacheKey, results, config.cacheTTLMinutes * 60 * 1000, mergeSearchResults);
    } catch (err) {
      console.error(`[plugin:${plugin.name}] 后台刷新失败: ${err instanceof Error ? err.message : err}`);
    }
  }
}
