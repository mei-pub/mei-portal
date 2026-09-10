// 高清888插件 —— Go plugin/gaoqing888 的代码级移植
// 站点 www.gaoqing888.com：搜索列表（div.video-row）→ 详情页并发抓取（8 并发）
// 解析 ul.playlist / div.wp-download 中的网盘链接 + 全页 magnet 正则。
// 有意简化：Go 的 http.Transport 连接池参数在事件循环下无意义，已删；
//           Go 协程乱序 append（mutex 保护），此处按列表顺序收集（allSettled），结果确定性更好；
//           time.Now() 语义保持（datetime 为抓取时刻）。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://www.gaoqing888.com';
const SEARCH_TIMEOUT = 15_000;
const DETAIL_TIMEOUT = 10_000;
const MAX_RETRIES = 3;
const MAX_CONCURRENCY = 8;

const DETAIL_ID_REGEX = /\/(\d+)\/detail/;
const MAGNET_REGEX = /magnet:\?xt=urn:btih:[0-9A-Za-z]+[^"' <]*/g;

interface ArticleItem {
  id: string;
  title: string;
  detailURL: string;
  imageURL: string;
  content: string;
}

/** 折叠空白（Go cleanText） */
function cleanText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** GET + 重试（网络错误与非 200 均退避重试，200ms * 2^attempt，Go fetchBody） */
async function fetchBody(requestURL: string, timeoutMs: number, referer: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(requestURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Connection: 'keep-alive',
          Referer: referer,
        },
        signal: controller.signal,
      });
      if (resp.status === 200) return await resp.text();
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 从 URL 查询参数提取密码（Go extractURLPassword） */
function extractURLPassword(rawURL: string): string {
  try {
    const u = new URL(rawURL);
    for (const key of ['pwd', 'passcode', 'code']) {
      const value = (u.searchParams.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* URL 非法返回空 */
  }
  return '';
}

/** 链接归一化：magnet 直收，/go/play?url= 解包，网盘域名判定（Go parseGaoqingLink） */
function parseGaoqingLink(raw: string): Link | null {
  raw = raw.trim();
  if (raw === '') return null;

  if (raw.toLowerCase().startsWith('magnet:')) return { type: 'magnet', url: raw, password: '' };

  if (raw.includes('/go/play?')) {
    try {
      const target = (new URL(raw, BASE_URL).searchParams.get('url') ?? '').trim();
      if (target !== '') raw = target;
    } catch {
      /* 保留原样 */
    }
  }

  const lower = raw.toLowerCase();
  if (lower.includes('pan.quark.cn')) return { type: 'quark', url: raw, password: extractURLPassword(raw) };
  if (lower.includes('pan.baidu.com')) return { type: 'baidu', url: raw, password: extractURLPassword(raw) };
  if (lower.includes('pan.xunlei.com')) return { type: 'xunlei', url: raw, password: extractURLPassword(raw) };
  if (lower.includes('alipan.com') || lower.includes('aliyundrive.com')) return { type: 'aliyun', url: raw, password: extractURLPassword(raw) };
  if (lower.includes('drive.uc.cn')) return { type: 'uc', url: raw, password: extractURLPassword(raw) };
  return null;
}

/** 搜索列表（Go fetchSearchResults） */
async function fetchSearchResults(keyword: string): Promise<ArticleItem[]> {
  const requestURL = `${BASE_URL}/search?kw=${encodeURIComponent(keyword)}`;
  const html = await fetchBody(requestURL, SEARCH_TIMEOUT, `${BASE_URL}/`);
  const $ = cheerio.load(html);

  const items: ArticleItem[] = [];
  $('div.wp-list.search-list div.video-row').each((_i, el) => {
    const s = $(el);
    const titleLink = s.find('a.title-link').first();
    const title = cleanText(titleLink.text());
    const detailURL = (titleLink.attr('href') ?? '').trim();
    if (title === '' || detailURL === '') return;

    const id = detailURL.match(DETAIL_ID_REGEX)?.[1] ?? '';
    if (id === '') return;

    const imageURL = (s.find('a.cover-link img.cover').attr('src') ?? '').trim();
    const content = cleanText([s.find('div.meta').eq(0).text(), s.find('div.meta').eq(1).text()].join(' | '));

    items.push({ id, title, detailURL, imageURL, content });
  });
  return items;
}

/** 详情页：链接 + 简介 + 标签（Go fetchDetail） */
async function fetchDetail(detailURL: string): Promise<{ links: Link[]; content: string; tags: string[] } | null> {
  const html = await fetchBody(detailURL, DETAIL_TIMEOUT, `${BASE_URL}/`);
  const $ = cheerio.load(html);

  const links: Link[] = [];
  const seen = new Set<string>();
  const add = (link: Link) => {
    if (link.url === '') return;
    const key = `${link.type}|${link.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  $('ul.playlist a[href], div.wp-download a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (href === undefined) return;
    const link = parseGaoqingLink(href);
    if (link !== null) add(link);
  });

  // goquery 的 doc.Html() 输出全部节点；cheerio 以 $.html() 等价复刻（Go magnetRegex 全页扫描）
  for (const magnet of html.match(MAGNET_REGEX) ?? []) {
    add({ type: 'magnet', url: magnet, password: '' });
  }

  if (links.length === 0) return null;

  let content = cleanText($('div.wp-content.video-detail p').first().text());
  if (content === '') content = cleanText($("meta[name='description']").attr('content') ?? '');

  const tags: string[] = [];
  const typ = cleanText($('div.info ul li').eq(3).text());
  if (typ !== '') tags.push(typ);

  return { links, content, tags };
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim();
    if (v === '' || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export const gaoqing888 = definePlugin({
  name: 'gaoqing888',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const items = await fetchSearchResults(keyword);
    if (items.length === 0) return [];

    // 并发抓详情页（Go semaphore maxConcurrency=8）；无链接的条目丢弃
    const limit = createLimiter(MAX_CONCURRENCY);
    const settled = await Promise.allSettled(items.map((item) => limit(() => fetchDetail(item.detailURL))));

    const results: SearchResult[] = [];
    settled.forEach((s, idx) => {
      if (s.status !== 'fulfilled' || s.value === null) return;
      const item = items[idx];
      let content = s.value.content;
      if (content === '') content = item.content;
      const images = dedupeStrings([item.imageURL]);
      results.push({
        message_id: '',
        unique_id: `gaoqing888-${item.id}`,
        channel: '', // 插件结果 Channel 必须为空
        datetime: new Date().toISOString(),
        title: item.title,
        content,
        links: s.value.links,
        tags: s.value.tags,
        images: images.length > 0 ? images : undefined,
      });
    });
    return filterResultsByKeyword(results, keyword);
  },
});
