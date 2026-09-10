// 链接有效性检查 —— Go service/check_service.go 的通用简化版
// Go 版对夸克/百度等有私有 API 探测，这里先以「页面探测 + 状态启发式」覆盖常见判定，
// 状态机（ok/bad/locked/unsupported/uncertain）与响应结构完全对齐，后续按需补各网盘私有 API。

import { fetchProbe } from '../http.ts';
import { getLinkType, cleanBaiduPanURL, cleanTianyiPanURL, cleanUCPanURL, clean123PanURL, clean115PanURL, cleanAliyunPanURL, cleanMobilePanURL } from '../regex.ts';
import type { CheckItem, CheckResult } from '../types.ts';

const BAD_HINTS = ['失效', '不存在', '违规', '已删除', '已过期', '被取消', 'shareinfonotfound', 'sharenotfound', 'filenotfound', 'shareexpirederror', 'foldernotfound', 'not found', 'deleted', '取消'];
const LOCK_HINTS = ['需要输入提取码', '访问码', '请输入密码', '违法内容', '审核', '封禁'];
// 登录跳转不算失效：分享页本身可能要求登录态

interface CachedCheck extends CheckResult {}

const checkCache = new Map<string, CachedCheck>();
const CHECK_TTL_MS = 30 * 60 * 1000;

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

  try {
    const referer = `https://${new URL(item.url).hostname}`;
    const { status, finalUrl, body } = await fetchProbe(item.url, {
      timeoutMs: 10_000,
      headers: { Referer: referer },
      // 失效特征判定只看前几千字符，限制下载避免整页拉取大响应
      maxBodyBytes: 64 * 1024,
    });
    const text = (finalUrl + ' ' + body.slice(0, 4000)).toLowerCase();

    if (status === 404 || status === 410) return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'bad', summary: '链接失效' };
    if (status === 403 || status === 451) return { ...base, state: 'locked', summary: '链接被锁定或禁止访问' };
    if (status >= 400) return { ...base, state: 'bad', summary: `链接失效(HTTP ${status})` };

    if (BAD_HINTS.some((h) => text.includes(h))) {
      return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'bad', summary: '链接失效' };
    }
    if (LOCK_HINTS.some((h) => text.includes(h))) {
      return { ...base, state: 'locked', summary: '链接需要提取码或已被锁定' };
    }
    return { ...base, normalized_url: normalizeUrl(item.disk_type, item.url), state: 'ok', summary: '链接有效' };
  } catch (err) {
    return { ...base, state: 'uncertain', summary: `无法访问: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 批量检查（带内存缓存，Go bbolt 换内存 Map） */
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
      const result = await probeOne(item);
      checkCache.set(cacheKey, result);
      results.push(result);
    }),
  );
  return { results };
}
