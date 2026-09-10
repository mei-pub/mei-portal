// KKV 影视搜索插件 —— Go plugin/kkv 的复刻
// 契约：kkv.q-23.cn（WordPress 站）。GET /?s=<kw> 拿列表（article.post + ?p=ID），
// 标题含关键词过滤后最多取 10 条并发（3）抓详情页，从 .entry-content 段落提取网盘链接。

import * as cheerio from 'cheerio';
import { createLimiter, fetchProbe } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

const BASE_URL = 'http://kkv.q-23.cn';
const SEARCH_PATH = '/';
const MAX_RESULTS = 10;
const MAX_CONCURRENT = 3;
const REQUEST_TIMEOUT = 30_000;
const MAX_RETRIES = 3;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  Referer: BASE_URL,
};

const DETAIL_ID_PATTERN = /\?p=(\d+)/;
const PWD_PATTERNS = [/提取码[：:]\s*([a-zA-Z0-9]{4})/, /密码[：:]\s*([a-zA-Z0-9]{4})/, /pwd[：:]\s*([a-zA-Z0-9]{4})/];

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
}

/** 带重试的 GET：仅 200 视为成功，退避 200ms * 2^(i-1)（Go doRequestWithRetry） */
async function fetchHtmlWithRetry(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (i - 1)));
    try {
      const { status, body } = await fetchProbe(url, { timeoutMs: REQUEST_TIMEOUT, headers: BROWSER_HEADERS });
      if (status === 200) return body;
      lastErr = new Error(`HTTP ${status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`[kkv] 重试 ${MAX_RETRIES} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 解析搜索列表页（Go fetchSearchResults） */
async function fetchSearchResults(searchURL: string): Promise<SearchItem[]> {
  const html = await fetchHtmlWithRetry(searchURL);
  const $ = cheerio.load(html);
  const items: SearchItem[] = [];
  $('article.post').each((_i, post) => {
    const link = $(post).find('.entry-header h2.entry-title a');
    const href = link.attr('href');
    if (href === undefined) return;
    const title = link.text().trim();
    if (title === '') return;
    const id = href.match(DETAIL_ID_PATTERN)?.[1];
    if (id === undefined) return;
    items.push({ id, title, detailURL: href });
  });
  return items;
}

/** 标题含关键词过滤（Go filterItemsByKeyword，小写包含） */
function filterItemsByKeyword(items: SearchItem[], keyword: string): SearchItem[] {
  const lowerKeyword = keyword.toLowerCase();
  return items.filter((item) => item.title.toLowerCase().includes(lowerKeyword));
}

/** 网盘类型识别（Go determinePanType） */
function determinePanType(panURL: string): string {
  const lower = panURL.toLowerCase();
  if (lower.includes('pan.baidu.com')) return 'baidu';
  if (lower.includes('pan.quark.cn')) return 'quark';
  if (lower.includes('drive.uc.cn')) return 'uc';
  if (lower.includes('pan.xunlei.com')) return 'xunlei';
  if (lower.includes('aliyundrive.com') || lower.includes('alipan.com')) return 'aliyun';
  if (lower.includes('cloud.189.cn')) return 'tianyi';
  if (lower.includes('115.com') || lower.includes('115cdn.com') || lower.includes('anxia.com')) return '115';
  if (
    lower.includes('123684.com') ||
    lower.includes('123685.com') ||
    lower.includes('123912.com') ||
    lower.includes('123pan.com') ||
    lower.includes('123pan.cn') ||
    lower.includes('123592.com')
  ) {
    return '123';
  }
  if (lower.includes('caiyun.139.com')) return 'mobile';
  if (lower.includes('mypikpak.com')) return 'pikpak';
  return '';
}

/** 密码提取：URL pwd（4 位）优先，其次段落文本正则（Go extractPassword） */
function extractPassword(panURL: string, contextText: string): string {
  try {
    const pwd = new URL(panURL).searchParams.get('pwd') ?? '';
    if (pwd !== '' && pwd.length === 4) return pwd;
  } catch {
    /* 无效 URL 走文本提取 */
  }
  for (const pattern of PWD_PATTERNS) {
    const m = contextText.match(pattern);
    if (m !== null) return m[1];
  }
  return '';
}

/** 详情页时间：time.updated[datetime] RFC3339，缺失或无效取当前（Go extractUpdateTime） */
function extractUpdateTime($: cheerio.CheerioAPI): string {
  const timeStr = $('time.updated').attr('datetime');
  if (timeStr === undefined) return new Date().toISOString();
  const parsed = new Date(timeStr);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/** 从 .entry-content 段落提取网盘链接（Go extractPanLinks） */
function extractPanLinks($: cheerio.CheerioAPI): Link[] {
  const links: Link[] = [];
  $('.entry-content p').each((_i, p) => {
    const paragraph = $(p);
    const contextText = paragraph.text();
    paragraph.find('a').each((_j, a) => {
      const href = ($(a).attr('href') ?? '').trim();
      if (href === '') return;
      const cloudType = determinePanType(href);
      if (cloudType === '') return;
      links.push({ type: cloudType, url: href, password: extractPassword(href, contextText) });
    });
  });
  return links;
}

/** 抓取单个详情页并组装结果；失败或无链接返回 null（Go processDetailPage） */
async function processDetailPage(item: SearchItem): Promise<SearchResult | null> {
  let html: string;
  try {
    html = await fetchHtmlWithRetry(item.detailURL);
  } catch {
    return null; // Go：请求失败静默跳过
  }
  const $ = cheerio.load(html);

  let title = $('.entry-header h1.entry-title').text().trim();
  if (title === '') title = item.title;

  // 简介：首个 .entry-content 段落，截断 200 字符（Go：截断 200 字节 + "..."）
  let description = '';
  const firstP = $('.entry-content p').first();
  if (firstP.length > 0) {
    description = firstP.text().trim();
    if (description.length > 200) description = `${description.slice(0, 200)}...`;
  }

  const panLinks = extractPanLinks($);
  if (panLinks.length === 0) return null;

  return {
    message_id: '',
    unique_id: `kkv-${item.id}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime: extractUpdateTime($),
    title,
    content: description,
    links: panLinks,
  };
}

export const kkv = definePlugin({
  name: 'kkv',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?s=${encodeURIComponent(keyword)}`;
    const items = await fetchSearchResults(searchURL);
    if (items.length === 0) return [];

    let filteredItems = filterItemsByKeyword(items, keyword);
    if (filteredItems.length === 0) return [];
    if (filteredItems.length > MAX_RESULTS) filteredItems = filteredItems.slice(0, MAX_RESULTS);

    // 并发抓详情页（Go semaphore → createLimiter；失败项静默丢弃）
    const limit = createLimiter(MAX_CONCURRENT);
    const results = await Promise.all(filteredItems.map((item) => limit(() => processDetailPage(item))));
    return results.filter((r): r is SearchResult => r !== null);
  },
});
