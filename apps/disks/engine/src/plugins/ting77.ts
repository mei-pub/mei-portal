// 77听（Ting77）搜索插件 —— Go plugin/ting77 的复刻
// 契约：sou.77ting.top 聚合站。列表页 a.resource-row 声明云盘徽标（quark/ali/baidu），
// 逐云盘经 /api/link/token 换令牌后请求 /go 跳转接口（不跟随重定向，读 Location）。
// 令牌接口限频：65s 滑动窗口内最多 8 次请求，超限立即终止剩余解析。

import * as cheerio from 'cheerio';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'ting77';
const BASE_URL = 'https://sou.77ting.top';
const REQUEST_TIMEOUT = 25_000;
const MAX_RESPONSE_BYTES = 4 << 20; // 4MB（搜索页）
const MAX_TOKEN_BYTES = 512 << 10; // 512KB（令牌/跳转接口）
const MAX_TOKEN_REQUESTS = 8;
const TOKEN_WINDOW_MS = 65_000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 令牌限频哨兵错误（Go errRateLimited） */
class RateLimitedError extends Error {
  constructor() {
    super('链接令牌请求过于频繁');
  }
}

/** 已解析链接缓存（Go sync.Map linkCache） */
const linkCache = new Map<string, Link>();

/** 令牌请求时间戳滑动窗口（Go tokenRequest + tokenMu） */
const tokenRequests: number[] = [];

function reserveTokenRequest(): void {
  const cutoff = Date.now() - TOKEN_WINDOW_MS;
  const kept = tokenRequests.filter((requestedAt) => requestedAt > cutoff);
  tokenRequests.length = 0;
  tokenRequests.push(...kept);
  if (tokenRequests.length >= MAX_TOKEN_REQUESTS) throw new RateLimitedError();
  tokenRequests.push(Date.now());
}

interface SearchEntry {
  id: string;
  title: string;
  description: string;
  size: string;
  tags: string[];
  cloudTypes: string[];
  datetime: string;
}

/** 站点云盘徽标类名归一化（Go normalizeSiteCloudType） */
function normalizeSiteCloudType(value: string): string {
  switch (value.trim().toLowerCase()) {
    case 'quark':
      return 'quark';
    case 'ali':
      return 'ali';
    case 'baidu':
      return 'baidu';
    default:
      return '';
  }
}

/** 云盘解析优先级：quark > ali > baidu（Go cloudTypePriority） */
function cloudTypePriority(value: string): number {
  switch (value) {
    case 'quark':
      return 0;
    case 'ali':
      return 1;
    case 'baidu':
      return 2;
    default:
      return 3;
  }
}

/** 跳转目标网盘类型识别（Go detectLinkType） */
function detectLinkType(rawURL: string): string {
  const lower = rawURL.toLowerCase();
  if (lower.includes('pan.quark.cn')) return 'quark';
  if (lower.includes('pan.baidu.com')) return 'baidu';
  if (lower.includes('aliyundrive.com') || lower.includes('alipan.com')) return 'aliyun';
  return 'others';
}

/** URL 查询参数提取密码：pwd/password/code（Go extractPassword） */
function extractPassword(rawURL: string): string {
  try {
    const params = new URL(rawURL).searchParams;
    for (const key of ['pwd', 'password', 'code']) {
      const value = (params.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* 无效 URL 无密码 */
  }
  return '';
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const parsed = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatContent(description: string, size: string): string {
  const parts: string[] = [];
  const desc = description.trim();
  if (desc !== '') parts.push(desc);
  const sz = size.trim();
  if (sz !== '') parts.push(`大小: ${sz}`);
  return parts.join(' | ');
}

function requestHeaders(referer: string, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: accept,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  };
  if (referer !== '') headers['Referer'] = referer;
  return headers;
}

/** 带状态码检查与大小上限的 GET（Go doLimitedRequest 变体） */
async function doGet(url: string, referer: string, accept: string, limit: number, redirect: RequestRedirect = 'follow'): Promise<{ body: string; location: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { headers: requestHeaders(referer, accept), redirect, signal: controller.signal });
    let body = '';
    if (redirect === 'manual') {
      // 跳转接口不跟随重定向，丢弃响应体
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > limit) throw new Error('响应超过大小上限');
      body = buf.toString('utf-8');
    } else {
      body = await resp.text();
      if (Buffer.byteLength(body) > limit) throw new Error('响应超过大小上限');
    }
    return { body, location: (resp.headers.get('location') ?? '').trim(), status: resp.status };
  } finally {
    clearTimeout(timer);
  }
}

/** 解析搜索列表页（Go parseSearchEntries） */
function parseSearchEntries(html: string): SearchEntry[] {
  const $ = cheerio.load(html);
  const entries: SearchEntry[] = [];
  $('a.resource-row').each((_i, row) => {
    const s = $(row);
    const href = (s.attr('href') ?? '').trim();
    // resourceID = path.Base(href)
    const resourceID = href.split('/').filter((p) => p !== '').pop() ?? '';
    const title = s.find('.row-title').first().text().trim();
    if (resourceID === '' || resourceID === '.' || title === '' || !href.startsWith('/resource/')) return;

    const entry: SearchEntry = {
      id: resourceID,
      title,
      description: s.find('.row-desc').first().text().trim(),
      size: s.find('.row-size').first().text().trim(),
      datetime: parseDate(s.find('.row-date').first().text().trim()),
      tags: [],
      cloudTypes: [],
    };
    s.find('.row-tag').each((_j, tag) => {
      const value = $(tag).text().trim();
      if (value !== '') entry.tags.push(value);
    });
    const cloudSet = new Set<string>();
    s.find('.cloud-badge').each((_j, badge) => {
      for (const className of ($(badge).attr('class') ?? '').split(/\s+/)) {
        const cloudType = normalizeSiteCloudType(className);
        if (cloudType !== '') cloudSet.add(cloudType);
      }
    });
    entry.cloudTypes = [...cloudSet].sort((a, b) => cloudTypePriority(a) - cloudTypePriority(b));
    if (entry.cloudTypes.length > 0) entries.push(entry);
  });
  return entries;
}

interface TokenResponse {
  code: number;
  message: string;
  data: { token: string; ts: string };
}

/** 获取链接令牌（Go fetchLinkToken） */
async function fetchLinkToken(resourceID: string, cloudType: string): Promise<{ token: string; ts: string }> {
  const query = new URLSearchParams({ id: resourceID, type: cloudType });
  const { status, body } = await doGet(
    `${BASE_URL}/api/link/token?${query}`,
    `${BASE_URL}/resource/${resourceID}`,
    'application/json',
    MAX_TOKEN_BYTES,
  );
  if (status !== 200) {
    if (status === 429) throw new RateLimitedError();
    throw new Error(`令牌接口返回状态码 ${status}`);
  }
  let token: TokenResponse;
  try {
    token = JSON.parse(body) as TokenResponse;
  } catch (err) {
    throw new Error(`解析链接令牌失败: ${err instanceof Error ? err.message : err}`);
  }
  if (token.code !== 0 || token.data?.token === '' || token.data?.ts === '') {
    if (token.code === 429) throw new RateLimitedError();
    throw new Error(`链接令牌无效: ${token.message}`);
  }
  return { token: token.data.token, ts: token.data.ts };
}

/** 解析单条网盘链接：换令牌 → /go 跳转 → Location（Go resolveLink） */
async function resolveLink(entry: SearchEntry, cloudType: string): Promise<Link> {
  const cacheKey = `${entry.id}\u0000${cloudType}`;
  const cached = linkCache.get(cacheKey);
  if (cached) return { ...cached, datetime: entry.datetime, work_title: entry.title };
  reserveTokenRequest();

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let token: { token: string; ts: string };
    try {
      token = await fetchLinkToken(entry.id, cloudType);
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      lastErr = err;
      continue;
    }

    const query = new URLSearchParams({ id: entry.id, type: cloudType, token: token.token, ts: token.ts });
    try {
      const { status, location } = await doGet(
        `${BASE_URL}/go?${query}`,
        `${BASE_URL}/resource/${entry.id}`,
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        MAX_TOKEN_BYTES,
        'manual',
      );
      if (status < 300 || status >= 400 || location === '') {
        lastErr = new Error(`跳转接口返回状态码 ${status}`);
        continue;
      }
      let resolved: URL;
      try {
        resolved = new URL(location);
      } catch {
        lastErr = new Error('跳转接口返回无效链接');
        continue;
      }
      if (resolved.protocol === '' || resolved.host === '') {
        lastErr = new Error('跳转接口返回无效链接');
        continue;
      }
      const linkType = detectLinkType(location);
      if (linkType === 'others') {
        lastErr = new Error(`跳转接口返回不支持的链接: ${resolved.host}`);
        continue;
      }
      const link: Link = {
        type: linkType,
        url: location,
        password: extractPassword(location),
        datetime: entry.datetime,
        work_title: entry.title,
      };
      linkCache.set(cacheKey, link);
      return link;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 逐条目逐云盘解析链接；限频时立即终止（Go resolveEntries） */
async function resolveEntries(entries: SearchEntry[]): Promise<{ results: SearchResult[]; lastErr: unknown }> {
  const results: SearchResult[] = [];
  let lastErr: unknown = null;
  for (const entry of entries) {
    const links: Link[] = [];
    for (const cloudType of entry.cloudTypes) {
      try {
        links.push(await resolveLink(entry, cloudType));
      } catch (err) {
        lastErr = err;
        if (err instanceof RateLimitedError) break;
        continue;
      }
    }
    if (links.length > 0) {
      results.push({
        message_id: '',
        unique_id: `${PLUGIN_NAME}-${entry.id}`,
        channel: '', // 插件结果 Channel 必须为空
        datetime: entry.datetime,
        title: entry.title,
        content: formatContent(entry.description, entry.size),
        tags: entry.tags,
        links,
      });
    }
    if (lastErr instanceof RateLimitedError) break;
  }
  return { results, lastErr };
}

export const ting77 = definePlugin({
  name: PLUGIN_NAME,
  priority: 2,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    const { body } = await doGet(
      `${BASE_URL}/search?q=${encodeURIComponent(kw)}`,
      `${BASE_URL}/`,
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      MAX_RESPONSE_BYTES,
    );
    const entries = parseSearchEntries(body);
    if (entries.length === 0) return [];

    const { results, lastErr } = await resolveEntries(entries);
    if (results.length === 0 && lastErr != null) {
      throw new Error(`[ting77] 获取网盘链接失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
    }
    return filterResultsByKeyword(results, kw);
  },
});
