// 电影云集 Pro（DYYJPRO）网盘搜索插件 —— Go plugin/dyyjpro 的复刻
// 站点 dyyjpro.com（WordPress）。契约：GET /?cat=&s=<kw> 列表页 → 并发抓
// article.post-content 详情页，从 a[href] 与纯文本双通道提取网盘/磁力链接。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://dyyjpro.com';
const SEARCH_URL = `${BASE_URL}/?cat=&s=%s`;
const SEARCH_TIMEOUT_MS = 15_000; // Go searchTimeout
const DETAIL_TIMEOUT_MS = 10_000; // Go detailTimeout
const MAX_RETRIES = 3;
const MAX_CONCURRENCY = 12;

// 预编译正则（原样搬运）
const POST_ID_REGEX = /\/(\d+)\.html?$/;
const TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const SPACE_REGEX = /\s+/;

const LINK_PATTERNS: Array<{ reg: RegExp; typ: string }> = [
  [/https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+(?:\?pwd=[0-9A-Za-z]+)?/, 'quark'],
  [/https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+(?:\?pwd=[0-9A-Za-z]+)?/, 'baidu'],
  [/https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/, 'xunlei'],
  [/https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, 'uc'],
  [/https?:\/\/(?:www\.)?(?:alipan\.com|aliyundrive\.com)\/s\/[0-9A-Za-z]+/, 'aliyun'],
  [/https?:\/\/(?:www\.)?(?:123pan\.com|123684\.com|123865\.com|123685\.com|123592\.com|123912\.com)\/s\/[0-9A-Za-z]+/, '123'],
  [/magnet:\?xt=urn:btih:[0-9A-Za-z]+/, 'magnet'],
];

const PASSWORD_PATTERNS = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

/** 带重试的抓取（Go fetchBody）：3 次尝试，非 200 也重试，每次尝试独立超时，退避 200ms * 2^attempt */
async function fetchBody(requestURL: string, timeoutMs: number, referer: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(requestURL, { headers: { ...REQUEST_HEADERS, Referer: referer }, signal: controller.signal });
      if (resp.status === 200) return await resp.text();
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 文本清洗（Go cleanText） */
function cleanText(text: string): string {
  text = text.replace(/\u00a0/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
  return text.replace(SPACE_REGEX, ' ').trim();
}

/** URL 补全（Go normalizeURL）：相对路径 → 站点绝对地址 */
function normalizeURL(raw: string): string {
  raw = raw.trim();
  if (raw === '') return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return BASE_URL + raw;
  return BASE_URL + '/' + raw;
}

/** 从详情页 URL 提取文章 ID（Go extractPostID） */
function extractPostID(detailURL: string): string {
  return detailURL.match(POST_ID_REGEX)?.[1] ?? '';
}

/** 解析发布时间（Go parseDateTime，本地时区），失败取当前时间 */
function parseDateTime(raw: string): string {
  const s = cleanText(raw);
  if (s !== '') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString();
    const t = new Date(s);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return new Date().toISOString();
}

/** 从 URL query 提取密码（Go extractURLPassword） */
function extractURLPassword(rawURL: string): string {
  try {
    const u = new URL(rawURL);
    for (const key of ['pwd', 'passcode', 'code']) {
      const value = (u.searchParams.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* 解析失败返回空 */
  }
  return '';
}

/** 从上下文提取密码（Go matchPassword） */
function matchPassword(text: string): string {
  text = text.trim();
  if (text === '') return '';
  for (const pattern of PASSWORD_PATTERNS) {
    const m = text.match(pattern);
    if (m) return m[1].trim();
  }
  return extractURLPassword(text);
}

/** 链接分类（Go classifyLink）：返回 [类型, 归一化链接]，未命中返回 null */
function classifyLink(raw: string): { type: string; url: string } | null {
  const value = raw.trim();
  for (const pattern of LINK_PATTERNS) {
    const matched = value.match(pattern.reg);
    if (matched) return { type: pattern.typ, url: matched[0] };
  }
  return null;
}

function substring(text: string, start: number, end: number): string {
  if (start < 0) start = 0;
  if (end > text.length) end = text.length;
  if (start >= end) return '';
  return text.slice(start, end);
}

/** 字符串去重（Go dedupeStrings） */
function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = item.trim();
    if (t === '' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

type Selection = cheerio.Cheerio<never>;

/** 从选区提取链接（Go extractLinks）：a[href] + 纯文本双通道 */
function extractLinks($: cheerio.CheerioAPI, selection: Selection): Link[] {
  const results: Link[] = [];
  const seen = new Set<string>();

  const addLink = (rawURL: string, context: string) => {
    const hit = classifyLink(rawURL);
    if (!hit) return;
    const key = `${hit.type}|${hit.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ type: hit.type, url: hit.url, password: matchPassword(context) });
  };

  selection.find('a[href]').each((_i, node) => {
    const href = $(node).attr('href');
    if (!href) return;
    addLink(href, $(node).parent().text() + ' ' + $(node).text());
  });

  const text = selection.text();
  for (const m of text.matchAll(TEXT_URL_REGEX)) {
    addLink(m[0], substring(text, m.index! - 80, m.index! + m[0].length + 80));
  }

  return results;
}

/** 列表页条目（Go articleItem） */
interface ArticleItem {
  id: string;
  title: string;
  detailURL: string;
  category: string;
  publishRaw: string;
}

/** 获取搜索结果列表（Go fetchSearchResults） */
async function fetchSearchResults(keyword: string): Promise<ArticleItem[]> {
  const requestURL = SEARCH_URL.replace('%s', encodeURIComponent(keyword));
  const html = await fetchBody(requestURL, SEARCH_TIMEOUT_MS, BASE_URL + '/');
  const $ = cheerio.load(html);

  const items: ArticleItem[] = [];
  $('article.post-item.item-grid').each((_i, s) => {
    const el = $(s);
    const titleLink = el.find('h2.entry-title a').first();
    const title = cleanText(titleLink.text());
    const detailURL = titleLink.attr('href') ?? '';
    if (detailURL === '' || title === '') return;

    const id = extractPostID(detailURL);
    if (id === '') return;

    const category = cleanText(el.find('span.meta-cat-dot a').first().text());
    const publishRaw = (el.find('time.pub-date').attr('datetime') ?? '').trim();

    items.push({ id, title, detailURL, category, publishRaw });
  });
  return items;
}

/** 获取详情页（Go fetchDetail）：链接、正文摘要、图片 */
async function fetchDetail(detailURL: string): Promise<{ links: Link[]; content: string; images: string[] } | null> {
  const html = await fetchBody(detailURL, DETAIL_TIMEOUT_MS, BASE_URL + '/');
  const $ = cheerio.load(html);

  let contentNode = $('article.post-content').first();
  if (contentNode.length === 0) contentNode = $.root() as unknown as Selection; // Go doc.Selection

  const links = extractLinks($, contentNode);
  if (links.length === 0) return null;

  let content = cleanText(contentNode.text());
  if (content.length > 300) content = content.slice(0, 300) + '...';

  const images: string[] = [];
  const coverBg = $('div.archive-hero-bg').first().attr('data-bg');
  if (coverBg) images.push(normalizeURL(coverBg));
  const imgSrc = contentNode.find('img').first().attr('src');
  if (imgSrc) images.push(normalizeURL(imgSrc));

  return { links, content, images: dedupeStrings(images) };
}

export const dyyjpro = definePlugin({
  name: 'dyyjpro',
  priority: 2, // Go defaultPriority
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const items = await fetchSearchResults(keyword);
    if (items.length === 0) return [];

    const limit = createLimiter(MAX_CONCURRENCY);
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const detail = await limit(() => fetchDetail(item.detailURL));
          if (!detail) return null; // 详情无有效链接
          const tags: string[] = [];
          if (item.category !== '') tags.push(item.category);
          return {
            message_id: '',
            unique_id: `dyyjpro-${item.id}`,
            channel: '', // 插件搜索结果 Channel 必须为空
            datetime: parseDateTime(item.publishRaw),
            title: item.title,
            content: detail.content,
            links: detail.links,
            tags,
            images: detail.images,
          } satisfies SearchResult;
        } catch {
          return null; // Go：详情页失败静默跳过
        }
      }),
    );

    return filterResultsByKeyword(
      results.filter((r): r is SearchResult => r !== null),
      keyword,
    );
  },
});
