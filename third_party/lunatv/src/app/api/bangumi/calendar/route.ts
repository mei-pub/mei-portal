import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

import {
  convertBangumiDataToCalendar,
  isNativeCalendarPayload,
} from '@/lib/bangumi-adapter';
import { cachedFetchJson } from '@/lib/api-cache';
import { fetchJsonWithDoh } from '@/lib/doh-fetch';
import { getCacheTime } from '@/lib/config';

export const runtime = 'nodejs';
// 必须 force-dynamic：无参数 GET 默认会被 Next 在构建期静态化为快照，
// 运行时永远返回构建数据（放送表永不更新，且构建机网络与部署环境不同）
export const dynamic = 'force-dynamic';

/**
 * 番剧每日放送日历。
 * 本部署环境 DNS 污染导致 api.bgm.tv 直接 fetch 永远失败（解析到污染 IP），
 * 因此采用多源策略：
 *   1. api.bgm.tv 经 DoH（阿里/腾讯公共 DNS）解析真实 Cloudflare IP 后直连（SNI 用原域名）
 *   2. unpkg 上的 bangumi-data 全量放送数据（转换为日历格式）
 *   3. fastly.jsdelivr 的 bangumi-data（unpkg 兜底）
 * 并配两层缓存：
 *   - 进程内存（6 小时，同参并发去重）
 *   - 磁盘持久化（/data/lunatv/cache/bangumi-calendar.json）：
 *     重启不丢数据；全部上游失败时回退到最后一次成功数据（放送表一天一变，陈旧数据远好于空白）
 */

const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
// lunatv 无独立 DATA_DIR（容器内主卷为 /data），缓存固定落 /data/lunatv/cache；
// 本地开发无该路径时 saveToDisk 静默降级（仅丢失重启兜底），可用 LUNATV_CACHE_DIR 覆盖
const CACHE_FILE = path.join(
  process.env.LUNATV_CACHE_DIR || '/data/lunatv/cache',
  'bangumi-calendar.json'
);

const BGM_HEADERS = {
  'User-Agent': 'mei-allin/lunatv (https://github.com/mei-allin)',
  Accept: 'application/json',
};

const DATA_SOURCES: Array<{
  name: string;
  load: () => Promise<unknown>;
}> = [
  {
    name: 'bgm-tv-doh',
    load: () => fetchJsonWithDoh('api.bgm.tv', '/calendar', BGM_HEADERS),
  },
];

async function fetchSource(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 依次尝试各数据源，返回第一个成功的日历数据与来源名 */
async function loadCalendarFromSources(): Promise<{
  data: unknown;
  source: string;
}> {
  const errors: string[] = [];
  for (const source of DATA_SOURCES) {
    try {
      const raw = await source.load();
      if (isNativeCalendarPayload(raw)) {
        return { data: raw, source: source.name };
      }
      const converted = convertBangumiDataToCalendar(raw as Parameters<
        typeof convertBangumiDataToCalendar
      >[0]);
      const total = converted.reduce((sum, g) => sum + g.items.length, 0);
      if (total > 0) {
        return { data: converted, source: source.name };
      }
      errors.push(`${source.name}: 转换后无数据`);
    } catch (error) {
      errors.push(`${source.name}: ${(error as Error).message}`);
    }
  }
  throw new Error(`全部数据源失败 → ${errors.join('; ')}`);
}

/** 磁盘兜底：读取最后一次成功的数据（无论多旧） */
function loadFromDisk(): unknown {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: unknown };
    if (parsed?.data && Array.isArray(parsed.data)) {
      return parsed.data;
    }
  } catch {
    // 无缓存文件或不可读：静默降级
  }
  return null;
}

function saveToDisk(data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ savedAt: Date.now(), data }, null, 0)
    );
  } catch {
    // 磁盘不可写：仅影响重启后的兜底，不影响本次响应
  }
}

// 浏览器缓存时间：沿用站点配置（与其它豆瓣接口一致）
async function getCacheTimeValue(): Promise<string> {
  return String(await getCacheTime());
}

export async function GET() {
  try {
    const { data, source } = await cachedFetchJson(
      'bangumi:calendar:v1',
      MEMORY_TTL_MS,
      loadCalendarFromSources
    );
    saveToDisk(data);
    const cacheTime = await getCacheTimeValue();
    return NextResponse.json(data, {
      headers: {
        'X-Bangumi-Source': source,
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    // 全部上游失败：回退磁盘兜底（陈旧数据远好于空白放送表）
    const stale = loadFromDisk();
    if (stale) {
      return NextResponse.json(stale, {
        headers: { 'X-Bangumi-Source': 'disk-fallback' },
      });
    }
    return NextResponse.json(
      { error: '获取番剧日历失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
