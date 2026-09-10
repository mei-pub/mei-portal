// 链接有效性检查 —— Go service/check_service.go 的分层降级版
// 第一层：各网盘私有 API 精确判定（netdisk-check.ts，对齐 Go 版私有 API 探测）
// 第二层：API 不可用（网络/风控/无法判定）时降级为「页面探测 + 状态启发式」
// 状态机（ok/bad/locked/unsupported/uncertain）与响应结构完全对齐（新增可选 checked_via 字段）。

import { fetchProbe } from '../http.ts';
import { getLinkType, cleanBaiduPanURL, cleanTianyiPanURL, cleanUCPanURL, clean123PanURL, clean115PanURL, cleanAliyunPanURL, cleanMobilePanURL } from '../regex.ts';
import type { CheckItem, CheckResult } from '../types.ts';
import { checkNetdiskApi } from './netdisk-check.ts';

const BAD_HINTS = ['失效', '不存在', '违规', '已删除', '已过期', '被取消', 'shareinfonotfound', 'sharenotfound', 'filenotfound', 'shareexpirederror', 'foldernotfound', 'not found', 'deleted', '取消'];
const LOCK_HINTS = ['需要输入提取码', '访问码', '请输入密码', '违法内容', '审核', '封禁'];
// 登录跳转不算失效：分享页本身可能要求登录态

interface CachedCheck extends CheckResult {}

const checkCache = new Map<string, CachedCheck>();
const CHECK_TTL_MS = 30 * 60 * 1000;

/** 私有 API 探测并发上限（同一网盘接口不宜打太猛） */
const CHECK_CONCURRENCY = 6;

function createCheckLimiter(concurrency: number) {
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

const probeLimit = createCheckLimiter(CHECK_CONCURRENCY);

function normalizeUrl(diskType: string, url: string): string {
  switch (diskType) {
    case 'baidu':
      return cleanBaiduPanURL(url);
    case 'tianyi':
      return cleanTianyiPanURL(url);
    case 'uc':
      return cleanUCPanURL(url);
    case '123':
      return clean123PanURL(url);
    case '115':
      return clean115PanURL(url);
    case 'aliyun':
      return cleanAliyunPanURL(url);
    case 'mobile':
      return cleanMobilePanURL(url);
    default:
      return url;
  }
}

async function probeOne(item: CheckItem): Promise<CheckResult> {
  const now = Math.floor(Date.now() / 1000);
  const base: CheckResult = {
    disk_type: item.disk_type,
    url: item.url,
    state: 'uncertain',
    cache_hit: false,
    checked_at: now,
    expires_at: now + Math.floor(CHECK_TTL_MS / 1000),
  };

  // 磁力/电驴无法在线检查
  if (item.disk_type === 'magnet' || item.disk_type === 'ed2k') {
    return { ...base, state: 'unsupported', summary: '该类型链接暂不支持在线检查' };
  }
  if (getLinkType(item.url) === 'others') {
    return { ...base, state: 'unsupported', summary: '未知网盘类型，暂不支持检查' };
  }

  // 第一层：网盘私有 API 精确判定（含带码校验）
  const api = await checkNetdiskApi(item.disk_type, item.url, item.password ?? '');
  if (api) {
    return {
      ...base,
      normalized_url: normalizeUrl(item.disk_type, item.url),
      state: api.state,
      summary: api.summary,
      checked_via: `api:${item.disk_type}`,
    };
  }

  // 第二层：降级页面探测（API 不可用/风控/无法判定 ≠ 链接失效）
  try {
    const referer = `https://${new URL(item.url).hostname}`;
    const { status, finalUrl, body } = await fetchProbe(item.url, {
      timeoutMs: 10_000,
      headers: { Referer: referer },
      // 失效特征判定只看前几千字符，限制下载避免整页拉取大响应
      maxBodyBytes: 64 * 1024,
    });
    const text = (finalUrl + ' ' + body.slice(0, 4000)).toLowerCase();

    if (status === 404 || status === 410) return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'bad', summary: '链接失效', checked_via: 'page' };
    if (status === 403 || status === 451) return { ...base, state: 'locked', summary: '链接被锁定或禁止访问', checked_via: 'page' };
    if (status >= 400) return { ...base, state: 'bad', summary: `链接失效(HTTP ${status})`, checked_via: 'page' };

    if (BAD_HINTS.some((h) => text.includes(h))) {
      return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'bad', summary: '链接失效', checked_via: 'page' };
    }
    if (LOCK_HINTS.some((h) => text.includes(h))) {
      return { ...base, state: 'locked', summary: '链接需要提取码或已被锁定', checked_via: 'page' };
    }
    return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'ok', summary: '链接有效', checked_via: 'page' };
  } catch (err) {
    return { ...base, state: 'uncertain', summary: `无法访问: ${err instanceof Error ? err.message : String(err)}`, checked_via: 'page' };
  }
}

/** 批量检查（带内存缓存 + 并发限制，Go bbolt 换内存 Map） */
export async function checkLinks(items: CheckItem[]): Promise<{ results: CheckResult[] }> {
  const results: CheckResult[] = [];
  await Promise.all(
    items.map(async (item) => {
      const cacheKey = `${item.disk_type}|${item.url}`;
      const cached = checkCache.get(cacheKey);
      if (cached && cached.expires_at > Math.floor(Date.now() / 1000)) {
        results.push({ ...cached, cache_hit: true });
        return;
      }
      const result = await probeLimit(() => probeOne(item));
      checkCache.set(cacheKey, result);
      results.push(result);
    }),
  );
  return { results };
}
