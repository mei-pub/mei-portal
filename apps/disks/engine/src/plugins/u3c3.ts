// U3C3 磁力搜索插件 —— Go plugin/u3c3/u3c3.go 的复刻
// 站点 u3c3.com（备用 legacy 域名）：首页 JS 变量 nmefafej 即动态 search2 参数，
// 先取参数（缓存 1 小时）再搜索；结果为磁力表格行（tbody tr.default）。

import * as cheerio from 'cheerio';
import { fetchProbe } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://u3c3.com';
const LEGACY_BASE_URL = 'https://u3c3u3c3.u3c3u3c3u3c3.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const SEARCH2_TTL_MS = 60 * 60 * 1000; // search2 参数缓存 1 小时

// 模块级缓存（对应 Go 插件结构体的字段：activeURL / search2 / lastSync）
let activeURL = BASE_URL;
let cachedSearch2 = '';
let lastSyncAt = 0;

type Doc = ReturnType<typeof cheerio.load>;

/** Go url.QueryEscape 等价（大写十六进制、空格 → '+'、转义 !'()*） */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function baseCandidates(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of [activeURL, BASE_URL, LEGACY_BASE_URL]) {
    if (candidate === '' || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/** 带重试的抓取（MaxRetries=2 次、间隔 500ms、非 200 视为失败） */
async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const { status, body } = await fetchProbe(url, { timeoutMs, headers });
      if (status === 200) return body;
      lastErr = new Error(`HTTP ${status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < MAX_RETRIES - 1) await sleep(RETRY_DELAY_MS);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 获取 search2 动态参数（逐候选域名尝试，成功后记住可用域名） */
async function getSearch2Parameter(): Promise<string> {
  // 缓存有效（1 小时内）直接返回
  if (cachedSearch2 !== '' && Date.now() - lastSyncAt < SEARCH2_TTL_MS) return cachedSearch2;

  let search2 = '';
  let lastErr: unknown = null;
  for (const baseURL of baseCandidates()) {
    try {
      const body = await fetchWithRetry(baseURL, 10_000, {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      });
      search2 = extractSearch2FromHTML(body);
      if (search2 !== '') {
        activeURL = baseURL;
        break;
      }
      lastErr = new Error('无法从首页提取search2参数');
    } catch (err) {
      lastErr = err;
    }
  }
  if (search2 === '') {
    if (lastErr === null) lastErr = new Error('u3c3 所有域名均不可用');
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  cachedSearch2 = search2;
  lastSyncAt = Date.now();
  return search2;
}

/** 从首页 HTML 中提取 search2 参数（按行处理，跳过注释行） */
function extractSearch2FromHTML(html: string): string {
  for (const rawLine of html.split('\n')) {
    const line = rawLine.trim();
    // 跳过注释行
    if (line.startsWith('//')) continue;

    if (line.includes('nmefafej') && line.includes('"')) {
      const m = /var\s+nmefafej\s*=\s*"([^"]+)"/.exec(line);
      if (m && m[1].length > 5) return m[1];

      // 备用方案：直接提取引号内容
      const start = line.indexOf('"');
      if (start !== -1) {
        const closing = line.indexOf('"', start + 1);
        if (closing !== -1 && closing - (start + 1) > 5) {
          const candidate = line.slice(start + 1, closing);
          if (candidate.length > 5) return candidate;
        }
      }
    }
  }
  return '';
}

/** 清理标题文本（去 HTML 标签 + 折叠空白） */
function cleanTitle(title: string): string {
  return title
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析日期（UTC；无法解析返回空串，Go 返回零值时间） */
function parseDateTime(dateStr: string): string {
  if (dateStr === '') return '';
  let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateStr);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString();
  // "01-02 15:04"（无年份）：Go 解析为 0000 年，这里保持一致
  m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(dateStr);
  if (m) {
    const d = new Date();
    d.setUTCFullYear(0, +m[1] - 1, +m[2]);
    d.setUTCHours(+m[3], +m[4], 0, 0);
    return d.toISOString();
  }
  return '';
}

/** 生成唯一 ID：Go 按 rune 逐字符 hash*31+codePoint，int64 回绕后取绝对值（BigInt 精确复刻） */
function generateUniqueID(title: string, size: string): string {
  const source = `u3c3-${title}-${size}`;
  const MASK = (1n << 64n) - 1n;
  const SIGN_BIT = 1n << 63n;
  let hash = 0n;
  for (const ch of source) {
    hash = (hash * 31n + BigInt(ch.codePointAt(0) ?? 0)) & MASK;
  }
  if (hash >= SIGN_BIT) hash -= 1n << 64n; // Go int 溢出回绕为负
  if (hash < 0n) hash = -hash;
  return `u3c3-${hash.toString()}`;
}

/** 执行搜索 */
async function doSearch(keyword: string, search2: string): Promise<SearchResult[]> {
  const searchURL = `${activeURL}/?search2=${search2}&search=${queryEscape(keyword)}`;
  const body = await fetchWithRetry(searchURL, 15_000, {
    'User-Agent': USER_AGENT,
    Referer: activeURL + '/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });
  return parseSearchResults(body);
}

/** 解析搜索结果表格 */
function parseSearchResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $('tbody tr.default').each((_i, row) => {
    const s = $(row);
    // 跳过置顶广告行
    const titleCell = s.find('td:nth-child(2)');
    if (titleCell.text().includes('[置顶]')) return;

    // 标题与详情链接
    const titleLink = titleCell.find('a');
    let title = titleLink.text().trim();
    if (title === '') return; // 跳过空标题
    title = cleanTitle(title);

    // 详情链接（相对路径拼当前可用域名；仅用于展示，此处保留在局部变量）
    let detailURL = titleLink.attr('href') ?? '';
    if (detailURL !== '' && !detailURL.startsWith('http')) detailURL = activeURL + detailURL;
    void detailURL;

    // 磁力链接（第 3 列）
    const links: Link[] = [];
    s.find("td:nth-child(3) a[href^='magnet:']").each((_j, a) => {
      const href = $(a).attr('href');
      if (href && href !== '') links.push({ type: 'magnet', url: href, password: '' });
    });

    // 文件大小 / 上传时间 / 分类
    const sizeText = s.find('td:nth-child(4)').text().trim();
    const dateText = s.find('td:nth-child(5)').text().trim();
    const categoryText = s.find('td:nth-child(1) a').attr('title') ?? '';

    const contentParts: string[] = [];
    if (categoryText !== '') contentParts.push(`分类: ${categoryText}`);
    if (sizeText !== '') contentParts.push(`大小: ${sizeText}`);
    if (dateText !== '') contentParts.push(`时间: ${dateText}`);

    results.push({
      message_id: '',
      unique_id: generateUniqueID(title, sizeText),
      channel: '', // 插件结果 Channel 必须为空
      datetime: parseDateTime(dateText),
      title,
      content: contentParts.join(' | '),
      links,
      tags: ['种子', '磁力链接'],
    });
  });

  return results;
}

export const u3c3 = definePlugin({
  name: 'u3c3',
  priority: 5, // Go NewBaseAsyncPluginWithFilter("u3c3", 5, true)
  skipServiceFilter: true, // 磁力源：跳过 Service 层过滤，插件内部按关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 第一步：获取 search2 动态参数
    const search2 = await getSearch2Parameter();
    // 第二步：执行搜索
    const results = await doSearch(keyword, search2);
    // 应用关键词过滤
    return filterResultsByKeyword(results, keyword);
  },
});
