// 小雨影视插件 —— Go plugin/xiaoyu 的代码级移植
// 站点 xykmovie.com：/s/<page>/<keyword> 分页列表（最多 10 页、5 并发），
// 链接经 base64 data-url 属性提供，host 白名单归一化。
// 有意简化：Go 的 http.Transport 连接池参数在事件循环下无意义，已删；
//           base64 解码用 Node 的宽松解码（等价于 Go 的 StdEncoding/RawStdEncoding 两段尝试）；
//           time.ParseInLocation(time.Local) 统一按 UTC 解析（与仓库其他插件一致）。

import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { createLimiter } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://xykmovie.com';
const REQUEST_TIMEOUT = 15_000;
const MAX_RETRIES = 2; // 额外重试次数（Go 循环 0..maxRetries，共 3 次尝试）
const MAX_PAGES = 10;
const MAX_PAGE_CONCURRENCY = 5;

const URL_REGEX = /https?:\/\/[^\s"'<>]+/;

// 常用命名实体（Go html.UnescapeString 为全量 HTML5 表，此处覆盖常用集 + 全量数字实体）
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
};

function unescapeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const cp = parseInt(body.slice(2), 16);
      return Number.isNaN(cp) ? whole : String.fromCodePoint(cp);
    }
    if (lower.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      return Number.isNaN(cp) ? whole : String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/** 实体解码 + 折叠空白（Go cleanText） */
function cleanText(value: string): string {
  return unescapeEntities(value).replace(/\s+/g, ' ').trim();
}

interface PageResult {
  results: SearchResult[];
  totalPages: number;
}

/** 单页请求：网络错误与非 200 均按 attempt*200ms 退避重试（Go doRequestWithRetry） */
async function fetchPage(keyword: string, page: number): Promise<PageResult> {
  const requestURL = `${BASE_URL}/s/${page}/${encodeURIComponent(keyword)}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 200));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const resp = await fetch(requestURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Connection: 'keep-alive',
          Referer: `${BASE_URL}/`,
        },
        signal: controller.signal,
      });
      if (resp.status === 200) {
        const html = await resp.text();
        return parsePage(html);
      }
      lastErr = new Error(`状态码 ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[xiaoyu] 第${page}页搜索请求失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

function parsePage(html: string): PageResult {
  const $ = cheerio.load(html);
  const totalPages = parseTotalPages($);
  const results: SearchResult[] = [];
  $('.search-list .item').each((_i, el) => {
    const parsed = parseItem($(el));
    if (parsed !== null) results.push(parsed);
  });
  return { results, totalPages };
}

/** ".count strong" 第二个元素形如 "1 / 8"（Go parseTotalPages） */
function parseTotalPages($: cheerio.CheerioAPI): number {
  const pageText = cleanText($('.count strong').eq(1).text());
  const parts = pageText.split('/');
  if (parts.length !== 2) return 1;
  const total = parseInt(parts[1].trim(), 10);
  if (Number.isNaN(total) || total < 1) return 1;
  return total;
}

/** data-url 为 base64 编码的分享链接（Go decodeDataURL） */
function decodeDataURL(value: string): string {
  value = value.trim();
  if (value === '') return '';
  const decoded = Buffer.from(value, 'base64').toString('utf-8').trim();
  if (decoded !== '' && !decoded.includes('://')) {
    return 'https://' + decoded.replace(/^\/+/, '');
  }
  return decoded;
}

/** host 白名单归一化（Go normalizeLink） */
function normalizeLink(raw: string): { type: string; url: string } | null {
  raw = unescapeEntities(raw).trim();
  if (raw === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.host === '') return null;

  const host = parsed.hostname.toLowerCase();
  if (host === 'pan.quark.cn') return { type: 'quark', url: parsed.toString() };
  if (host === 'pan.baidu.com') return { type: 'baidu', url: parsed.toString() };
  if (host === 'pan.xunlei.com') return { type: 'xunlei', url: parsed.toString() };
  if (host === 'drive.uc.cn') return { type: 'uc', url: parsed.toString() };
  if (host === 'www.alipan.com' || host === 'alipan.com' || host === 'www.aliyundrive.com' || host === 'aliyundrive.com')
    return { type: 'aliyun', url: parsed.toString() };
  if (host === 'cloud.189.cn') return { type: 'tianyi', url: parsed.toString() };
  if (host === '115.com' || host === '115cdn.com') return { type: '115', url: parsed.toString() };
  if (host === 'www.123pan.com' || host === '123pan.com' || host === 'www.123684.com' || host === '123684.com')
    return { type: '123', url: parsed.toString() };
  if (host === 'caiyun.139.com') return { type: 'mobile', url: parsed.toString() };
  if (host === 'mypikpak.com') return { type: 'pikpak', url: parsed.toString() };
  return null;
}

/** 从 URL 查询参数或附近文本提取密码（Go extractPassword） */
function extractPassword(linkURL: string, nearbyText: string): string {
  try {
    const parsed = new URL(linkURL);
    for (const key of ['pwd', 'password', 'code']) {
      const value = cleanPassword(parsed.searchParams.get(key) ?? '');
      if (value !== '') return value;
    }
  } catch {
    /* URL 非法则走文本提取 */
  }
  for (const marker of ['提取码:', '提取码：', '访问码:', '访问码：', '密码:', '密码：']) {
    const index = nearbyText.indexOf(marker);
    if (index >= 0) {
      const fields = nearbyText.slice(index + marker.length).trim().split(/\s+/);
      if (fields.length > 0) return cleanPassword(fields[0]);
    }
  }
  return '';
}

function cleanPassword(value: string): string {
  value = value.trim();
  if (value === '') return '';
  return value.replace(/^[#，,。.;；:：()（）[\]【】]+|[#，,。.;；:：()（）[\]【】]+$/g, '');
}

function parseItem(item: cheerio.Cheerio<never>): SearchResult | null {
  const openLink = item.find('.name a.open').first();
  const title = cleanText(openLink.text());
  if (title === '') return null;

  let rawURL = decodeDataURL(openLink.attr('data-url') ?? '');
  const copyText = unescapeEntities(item.find('a.copy[data-code]').first().attr('data-code') ?? '');
  if (rawURL === '') rawURL = copyText.match(URL_REGEX)?.[0] ?? '';
  const link = normalizeLink(rawURL);
  if (link === null) return null;

  let password = cleanPassword(openLink.attr('data-code') ?? '');
  if (password === '') password = extractPassword(link.url, copyText);

  let id = cleanText(openLink.attr('data-id') ?? '');
  if (id === '') {
    // sha256(title + \0 + url) 前 8 字节十六进制（Go hash[:8] → 16 个 hex 字符）
    id = createHash('sha256')
      .update(`${title} ${link.url}`)
      .digest('hex')
      .slice(0, 16);
  }

  let datetime = new Date().toISOString();
  const timeValue = cleanText(item.find('.atips').first().text());
  if (timeValue !== '') {
    const parsed = new Date(`${timeValue.replace(' ', 'T')}Z`);
    if (!Number.isNaN(parsed.getTime())) datetime = parsed.toISOString();
  }

  const content = cleanText(item.find('.atips').eq(1).text()).replace(/^【内容】：/, '').trim();

  return {
    message_id: `xiaoyu-${id}`,
    unique_id: `xiaoyu-${id}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime,
    title,
    content,
    links: [
      {
        type: link.type,
        url: link.url,
        password,
        work_title: title,
      },
    ],
  };
}

export const xiaoyu = definePlugin({
  name: 'xiaoyu',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = cleanText(keyword);
    if (kw === '') return [];

    const firstPage = await fetchPage(kw, 1);

    let totalPages = firstPage.totalPages;
    if (totalPages < 1) totalPages = 1;
    if (totalPages > MAX_PAGES) totalPages = MAX_PAGES;

    // 第 2 页起并发抓取（Go semaphore maxPageConcurrency），失败的页直接丢弃
    const pages: SearchResult[][] = new Array(totalPages);
    pages[0] = firstPage.results;
    if (totalPages > 1) {
      const limit = createLimiter(MAX_PAGE_CONCURRENCY);
      const settled = await Promise.allSettled(
        Array.from({ length: totalPages - 1 }, (_, i) => limit(() => fetchPage(kw, i + 2))),
      );
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') pages[i + 1] = s.value.results;
      });
    }

    // 按页序合并 + 首链接去重
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const result of page ?? []) {
        if (result.links.length === 0) continue;
        const key = `${result.links[0].url} ${result.links[0].password}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(result);
      }
    }
    return filterResultsByKeyword(results, kw);
  },
});
