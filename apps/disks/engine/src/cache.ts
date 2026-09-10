// 两级缓存 —— Go util/cache/ 的简化复刻：内存 Map（立即可见）+ 磁盘 JSON（md5 键）+ 批量延迟落盘
// gob 序列化换成 JSON（缓存格式为引擎内部私有，无兼容包袱）

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.ts';
import type { SearchResult } from './types.ts';

export function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

// ---- 缓存键（Go cache_key.go 语义）----

/** tg:<小写关键词>:<频道哈希>；频道列表排序，小列表逗号拼接、大列表整体 md5 */
export function generateTGCacheKey(keyword: string, channels: string[]): string {
  const sorted = [...channels].sort();
  const joined = sorted.join(',');
  const channelPart = joined.length > 64 ? md5(joined) : joined;
  return md5(`tg:${keyword.toLowerCase()}:${md5(channelPart)}`);
}

/** plugin:<小写关键词>:<插件哈希>；未指定插件用固定"全部"标记 */
export function generatePluginCacheKey(keyword: string, plugins: string[] | null): string {
  if (plugins === null || plugins.length === 0) return md5(`plugin:${keyword.toLowerCase()}:all`);
  const sorted = [...plugins.map((p) => p.toLowerCase())].sort();
  const joined = sorted.join(',');
  const pluginPart = joined.length > 64 ? md5(joined) : joined;
  return md5(`plugin:${keyword.toLowerCase()}:${md5(pluginPart)}`);
}

// ---- 内存层 ----

interface MemoryEntry {
  data: string; // JSON 序列化后的结果
  expiry: number;
}

// ---- 磁盘层 + 批量写 ----

/** 两级缓存（导出类仅为单测可构造独立实例；运行态统一使用下方单例） */
export class TwoLevelCache {
  private memory = new Map<string, MemoryEntry>();
  private pending = new Map<string, { key: string; json: string; ttlMs: number }>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly dir: string;
  private readonly enabled: boolean;
  private flushing = false;

  constructor() {
    this.enabled = config.cacheEnabled;
    this.dir = resolve(config.cachePath);
    if (this.enabled) {
      try {
        mkdirSync(this.dir, { recursive: true });
      } catch {
        this.enabled = false;
      }
    }
  }

  private diskPaths(key: string): { data: string; meta: string } {
    const h = md5(key);
    return { data: join(this.dir, `${h}.json`), meta: join(this.dir, `${h}.meta`) };
  }

  /** 读：内存 → 磁盘（磁盘命中回填内存）。返回反序列化结果或 null */
  get(key: string): SearchResult[] | null {
    const now = Date.now();
    const mem = this.memory.get(key);
    if (mem) {
      if (mem.expiry > now) return JSON.parse(mem.data);
      this.memory.delete(key);
    }
    if (!this.enabled) return null;
    const { data, meta } = this.diskPaths(key);
    try {
      if (!existsSync(meta)) return null;
      if (!existsSync(data)) {
        // meta 孤立：清掉以免每次读都空跑
        unlinkSync(meta);
        return null;
      }
      const metaJson = JSON.parse(readFileSync(meta, 'utf8')) as { key: string; expiry: number };
      if (metaJson.expiry <= now) {
        unlinkSync(data);
        unlinkSync(meta);
        return null;
      }
      const json = readFileSync(data, 'utf8');
      const parsed = JSON.parse(json) as SearchResult[];
      this.memory.set(key, { data: json, expiry: metaJson.expiry });
      return parsed;
    } catch {
      // 损坏的缓存对（半写/损坏 JSON）直接清除，避免每次读都反复解析失败
      try {
        unlinkSync(data);
      } catch { /* 忽略 */ }
      try {
        unlinkSync(meta);
      } catch { /* 忽略 */ }
      return null;
    }
  }

  /** 写内存（立即可见） */
  setMemoryOnly(key: string, results: SearchResult[], ttlMs: number): void {
    this.memory.set(key, { data: JSON.stringify(results), expiry: Date.now() + ttlMs });
  }

  /** 写两级：内存立即 + 磁盘走批量队列 */
  set(key: string, results: SearchResult[], ttlMs: number): void {
    this.setMemoryOnly(key, results, ttlMs);
    this.queueDiskWrite(key, results, ttlMs);
  }

  /** 插件缓存更新入口：读旧缓存 → 合并去重 → 两级写入（Go cacheUpdater 语义） */
  updateMerged(
    key: string,
    newResults: SearchResult[],
    ttlMs: number,
    merge: (existing: SearchResult[], incoming: SearchResult[]) => SearchResult[],
  ): SearchResult[] {
    if (newResults.length === 0) return [];
    const existing = this.get(key) ?? [];
    const merged = merge(existing, newResults);
    this.set(key, merged, ttlMs);
    return merged;
  }

  private queueDiskWrite(key: string, results: SearchResult[], ttlMs: number): void {
    if (!this.enabled) return;
    this.pending.set(key, { key, json: JSON.stringify(results), ttlMs });
    // 批量延迟落盘（默认 2s 攒批）
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 2000);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const items = [...this.pending.values()];
    this.pending.clear();
    try {
      for (const item of items) {
        const { data, meta } = this.diskPaths(item.key);
        const expiry = Date.now() + item.ttlMs;
        writeFileSync(data, item.json);
        writeFileSync(meta, JSON.stringify({ key: item.key, expiry, size: item.json.length }));
      }
      this.enforceMaxSize();
    } catch {
      /* 单条写失败不影响整体 */
    } finally {
      this.flushing = false;
      if (this.pending.size > 0 && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.flush();
        }, 2000);
      }
    }
  }

  /** 磁盘缓存总量控制（默认 100MB，超限按最旧删除；容量统计包含 .json 数据文件本体） */
  private enforceMaxSize(): void {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith('.meta'));
      let total = 0;
      const metas = files
        .map((f) => {
          const p = join(this.dir, f);
          try {
            const meta = JSON.parse(readFileSync(p, 'utf8')) as { key: string; expiry: number };
            const st = statSync(p);
            total += st.size;
            // 数据文件才是缓存体积的大头，必须一并计入
            try {
              total += statSync(p.replace(/\.meta$/, '.json')).size;
            } catch {
              /* meta 孤立（data 已被删）只计自身大小 */
            }
            return { p, meta, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((x): x is { p: string; meta: { key: string; expiry: number }; mtime: number } => x !== null)
        .sort((a, b) => a.mtime - b.mtime);
      const limit = config.cacheMaxSizeMB * 1024 * 1024;
      if (total <= limit) return;
      for (const item of metas) {
        if (total <= limit) break;
        try {
          const dataPath = item.p.replace(/\.meta$/, '.json');
          try {
            total -= statSync(dataPath).size;
            unlinkSync(dataPath);
          } catch {
            /* 数据文件可能已不存在 */
          }
          total -= statSync(item.p).size;
          unlinkSync(item.p);
        } catch {
          /* 忽略单文件删除失败 */
        }
      }
    } catch {
      /* 目录不可读时跳过清理 */
    }
    // 清理孤儿数据文件（flush 先写 data 后写 meta，中途崩溃会留下无 meta 的 .json；它们不可读、也不参与容量统计）
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        const metaPath = join(this.dir, f.replace(/\.json$/, '.meta'));
        if (!existsSync(metaPath)) {
          try {
            unlinkSync(join(this.dir, f));
          } catch {
            /* 忽略单文件删除失败 */
          }
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  /** 关停时强制落盘（supervisord stop 时调用） */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

export const cache = new TwoLevelCache();
