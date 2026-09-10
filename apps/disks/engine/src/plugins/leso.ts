// 乐搜（LESO）论坛搜索插件 —— Go plugin/leso/leso.go 的复刻
// 站点 www.leso.cc（Discuz，UTF-8）：POST /search.php → 帖子列表 .slst li.pbw
// → 帖子详情页提取网盘/磁力/ed2k 链接（含提取码识别）。
// 注意：Go 用 NewBaseAsyncPlugin（非 WithFilter 版），即不跳过 Service 层过滤。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'leso';
const BASE_URL = 'https://www.leso.cc';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 30;
const MAX_CONCURRENCY = 6;

const THREAD_ID_RE = /(?:tid=|thread-)([0-9]+)/;
const DATE_RE = /20[0-9]{2}[-/]([0-9]{1,2})[-/]([0-9]{1,2})(?:\s+([0-9]{1,2}):([0-9]{2}))?/;
const URL_RE = /(?:https?:\/\/|magnet:\?|ed2k:\/\/)[^\s<>"]+/gi;
const PASSWORD_RE = /(?:提取码|密码|访问码|提取密码|pwd|passcode|code)\s*[:：=]?\s*([0-9A-Za-z]{3,12})/i;

// 网盘/磁力链接识别模式（按 Go 顺序；分类返回首个命中的匹配片段）
const LINK_PATTERNS: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i, type: 'baidu' },
  { re: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i, type: 'quark' },
  { re: /https?:\/\/(?:www\.)?(?:aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i, type: 'aliyun' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i, type: 'uc' },
  { re: /https?:\/\/cloud\.189\.cn\/(?:t|web\/share)[^\s<>"]*/i, type: 'tianyi' },
  { re: /https?:\/\/(?:www\.)?115\.com\/[a-zA-Z0-9/?=&._-]+/i, type: '115' },
  {
    re: /https?:\/\/(?:www\.)?(?:123pan\.com|123684\.com|123865\.com|123685\.com|123592\.com|123912\.com)\/s\/[0-9A-Za-z_-]+(?:\?[^\s<>"]*)?/i,
    type: '123',
  },
  { re: /magnet:\?[^\s<>"']+/i, type: 'magnet' },
  { re: /ed2k:\/\/[^\s<>"']+/i, type: 'ed2k' },
];

type Doc = ReturnType<typeof cheerio.load>;

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
  datetime: string;
  /** Go 中计算但最终未用于详情页，保留以对齐 */
  summary: string;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** Go url.QueryEscape 等价（大写十六进制、空格 → '+'、转义 !'()*） */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function absoluteURL(raw: string): string {
  const v = raw.trim();
  if (
    v === '' ||
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('magnet:') ||
    v.startsWith('ed2k:')
  ) {
    return v;
  }
  if (v.startsWith('//')) return 'https:' + v;
  return BASE_URL + '/' + v.replace(/^\//, '');
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  plusmn: '±',
  sup2: '²',
  sup3: '³',
  times: '×',
  divide: '÷',
  pound: '£',
  euro: '€',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  frac12: '½',
  dagger: '†',
  larr: '←',
  rarr: '→',
};

/** HTML 实体解码（Go html.UnescapeString 的常用子集） */
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

/** 解析日期（本地时间，带可选时分；失败取当前时间） */
function parseDate(text: string): string {
  const m = DATE_RE.exec(text);
  if (m) {
    const year = Number(m[0].slice(0, 4));
    const parsed = new Date(year, Number(m[1]) - 1, Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/** 提交搜索表单并返回解析后的文档（UTF-8 站点） */
async function fetchSearchDoc(keyword: string): Promise<Doc> {
  // Go url.Values.Encode() 按键名排序输出：mod=forum&searchsubmit=yes&srchtxt=...
  const form = 'mod=forum&searchsubmit=yes&srchtxt=' + queryEscape(keyword);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(BASE_URL + '/search.php?searchsubmit=yes', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        Referer: BASE_URL + '/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (resp.status !== 200) throw new Error(`[${PLUGIN_NAME}] 搜索请求返回 HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer()).subarray(0, 6 << 20); // LimitReader 6MB
    return cheerio.load(buf.toString('utf-8'));
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取帖子详情并组装结果（无链接返回 null，错误吞掉） */
async function fetchDetail(item: SearchItem): Promise<SearchResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let html: string;
    try {
      const resp = await fetch(item.detailURL, {
        headers: { ...BROWSER_HEADERS, Referer: BASE_URL + '/' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (resp.status !== 200) return null;
      const buf = Buffer.from(await resp.arrayBuffer()).subarray(0, 8 << 20); // LimitReader 8MB
      html = buf.toString('utf-8');
    } finally {
      clearTimeout(timer);
    }
    const $ = cheerio.load(html);

    let contentNode = $("td[id^='postmessage_'], td.t_f").first();
    if (contentNode.length === 0) contentNode = $('body').first();
    const contentHTML = contentNode.html() ?? '';
    const contentTextRaw = cleanText(contentNode.text());
    const links = extractLinks(`${contentHTML}\n${contentTextRaw}`);
    if (links.length === 0) return null;

    let title = item.title;
    if (title === '') title = cleanText($('#thread_subject').first().text());
    if (title === '') title = '乐搜资源';

    let contentText = contentTextRaw;
    if (contentText.length > 600) contentText = contentText.slice(0, 600) + '...';
    for (const link of links) {
      if (!link.work_title) link.work_title = title;
    }

    const src = contentNode.find('img').first().attr('src');
    const imageURL = src ? absoluteURL(src) : '';

    const result: SearchResult = {
      message_id: `${PLUGIN_NAME}-${item.id}`,
      unique_id: `${PLUGIN_NAME}-${item.id}`,
      channel: '', // 插件结果 Channel 必须为空
      datetime: item.datetime,
      title,
      content: contentText,
      links,
    };
    if (imageURL !== '') result.images = [imageURL];
    return result;
  } catch {
    return null;
  }
}

/** 解析搜索结果列表项（.slst li.pbw → h3 a，tid 作 ID） */
function parseSearchItems($: Doc): SearchItem[] {
  const items: SearchItem[] = [];
  const seen = new Set<string>();
  $('.slst li.pbw').each((_i, li) => {
    const s = $(li);
    const anchor = s.find('h3 a').first();
    if (anchor.length === 0) return;
    const href = absoluteURL(anchor.attr('href') ?? '');
    if (href === '') return;
    const id = THREAD_ID_RE.exec(href)?.[1] ?? '';
    if (id === '') return;
    if (seen.has(id)) return;
    const title = cleanText(anchor.text());
    if (title === '') return;
    const text = cleanText(s.text());
    let summary = text;
    if (summary.length > 240) summary = summary.slice(0, 240) + '...';
    seen.add(id);
    items.push({ id, title, detailURL: href, datetime: parseDate(text), summary });
  });
  return items;
}

/** 从文本提取链接（实体解码后按 URL 正则匹配，取上下文 ±100 字符找提取码） */
function extractLinks(text: string): Link[] {
  const decoded = unescapeEntities(text);
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const m of decoded.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    const raw = m[0].replace(/[.,;，。；)）\]】]+$/, '');
    const { type, url } = classifyLink(raw);
    if (type === '' || url === '') continue;
    const key = `${type}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, idx - 100);
    const end = Math.min(decoded.length, idx + m[0].length + 100);
    const contextText = decoded.slice(start, end);
    links.push({ type, url, password: extractPassword(contextText) });
  }
  return links;
}

/** 链接分类：按模式表顺序返回首个命中的类型与匹配片段 */
function classifyLink(raw: string): { type: string; url: string } {
  const v = raw.trim();
  for (const p of LINK_PATTERNS) {
    const m = p.re.exec(v);
    if (m && m[0] !== '') return { type: p.type, url: m[0] };
  }
  return { type: '', url: '' };
}

/** 提取码识别：先按关键词正则，再回退 URL query 的 pwd/passcode/code */
function extractPassword(text: string): string {
  const m = PASSWORD_RE.exec(text);
  if (m) return m[1].trim();

  const t = text.trim();
  let params: URLSearchParams | null = null;
  try {
    params = new URL(t).searchParams;
  } catch {
    // Go url.Parse 对相对文本也按 '?' 解析 query；这里手动截取问号后首个无空白片段
    const qi = t.indexOf('?');
    if (qi !== -1) {
      const qs = /[^\s]+/.exec(t.slice(qi + 1))?.[0] ?? '';
      if (qs !== '') params = new URLSearchParams(qs);
    }
  }
  if (params) {
    for (const key of ['pwd', 'passcode', 'code']) {
      const value = (params.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  }
  return '';
}

export const leso = definePlugin({
  name: PLUGIN_NAME,
  priority: 3, // Go NewBaseAsyncPlugin("leso", 3)（非 WithFilter 版）
  skipServiceFilter: false, // 不跳过 Service 层过滤（插件内部仍按关键词过滤）
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    const $doc = await fetchSearchDoc(kw);
    const items = parseSearchItems($doc);
    if (items.length === 0) return [];
    if (items.length > MAX_RESULTS) items.length = MAX_RESULTS;

    // 并发抓详情页（Go semaphore 6 → createLimiter(6)）
    const limit = createLimiter(MAX_CONCURRENCY);
    const settled = await Promise.all(items.map((item) => limit(async () => fetchDetail(item))));
    const results = settled.filter((r): r is SearchResult => r !== null);

    return filterResultsByKeyword(results, kw);
  },
});
