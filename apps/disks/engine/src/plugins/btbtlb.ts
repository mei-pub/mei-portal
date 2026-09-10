// BT影视（btbtlb）插件 —— Go plugin/btbtlb 的复刻
//
// 流程：搜索影视条目（/search/<关键词>）→ 详情页解析资源列表
// （/tdown/ 磁力下载页 + /pdown/ 网盘下载页）→ 逐个资源页提取
// magnet/网盘链接与提取码。种子名常用点分隔，插件内部按关键词过滤，
// 跳过 Service 层过滤。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'btbtlb';
const BASE_URL = 'https://www.btbtlb.com';
const REQUEST_TIMEOUT = 20_000;
const MAX_SEARCH_ITEMS = 10;
const MAX_RESOURCES_PER_MOVIE = 12;
const MAX_CLOUD_RESOURCES = 4;
const MAX_RESOURCE_ITEMS = 40;
const MAX_MOVIE_CONCURRENCY = 4;
const MAX_RESOURCE_CONCURRENCY = 8;

const MAGNET_RE = /magnet:\?xt=urn:btih:[^\s"'<>]+/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const PASSWORD_RES = [
  /[?&](?:pwd|password|passcode)=([0-9a-zA-Z]+)/i,
  /(?:提取码|访问码|密码|取件码)\s*[:：]\s*([0-9a-zA-Z]+)/,
];
const DETAIL_ID_RE = /\/detail\/(\d+)\.html/;
const HASH_RE = /^[0-9a-f]{40}$/i;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
  description: string;
  image: string;
  tags: string[];
}

interface ResourceItem {
  id: string;
  title: string;
  url: string;
}

interface MovieDetail {
  title: string;
  description: string;
  image: string;
  tags: string[];
  resources: ResourceItem[];
  datetime: string; // ISO（Go zero time / time.Now 对应 '' / 当前时刻）
}

/** 抓取页面（超时 20s，状态码必须 200） */
async function fetchDocument(target: string, referer: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(target, {
      headers: { ...REQUEST_HEADERS, ...(referer !== '' ? { Referer: referer } : {}) },
      signal: controller.signal,
    });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 文本清理：&nbsp; 归一为空格，折叠空白 */
function cleanText(value: string): string {
  return value.replaceAll(' ', ' ').trim().split(/\s+/).filter((s) => s !== '').join(' ');
}

/** 相对 URL → 绝对 URL（magnet 原样返回） */
function absoluteURL(raw: string): string {
  raw = raw.trim();
  if (raw === '' || raw.startsWith('http://') || raw.startsWith('https://') || raw.toLowerCase().startsWith('magnet:')) {
    return raw;
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  return `${BASE_URL}/${raw.replace(/^\//, '')}`;
}

/** 详情页 ID（/detail/<n>.html），否则退化到末段路径 */
function detailID(raw: string): string {
  const m = raw.match(DETAIL_ID_RE);
  if (m) return m[1];
  return resourceID(raw);
}

/** 末段路径作为资源 ID（去 .html 后缀） */
function resourceID(raw: string): string {
  let value = raw.trim();
  if (value.endsWith('/')) value = value.slice(0, -1);
  const idx = value.lastIndexOf('/');
  if (idx >= 0) value = value.slice(idx + 1);
  return value.endsWith('.html') ? value.slice(0, -'.html'.length) : value;
}

/** FNV-1a 32 位短哈希（与 Go hash/fnv New32a 一致，十六进制无前导零） */
function shortHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function cleanResourceTitle(value: string): string {
  let v = cleanText(value);
  if (v.endsWith('.torrent')) v = v.slice(0, -'.torrent'.length);
  if (v.endsWith('.torren')) v = v.slice(0, -'.torren'.length);
  return v.trim();
}

/** img 元素的封面地址（data-src 优先） */
function imageURL(s: cheerio.Cheerio<any>): string {
  if (s.length === 0) return '';
  let value = (s.attr('data-src') ?? '').trim();
  if (value === '') value = (s.attr('src') ?? '').trim();
  return absoluteURL(value);
}

/** 按标签取 .video-info-items 的值（Go EachWithBreak 提前终止） */
function labeledValue($: cheerio.CheerioAPI, label: string): string {
  let value = '';
  $('.video-info-items').each((_i, s) => {
    if (!cleanText($(s).find('.video-info-itemtitle').first().text()).includes(label)) return true;
    value = $(s).find('.video-info-item').first().text().trim();
    return false; // break
  });
  return value;
}

/** 解析日期文本（多种布局，Go time.Parse 的 TS 等价物）；无法解析返回 '' */
function parseDateValue(value: string): string {
  value = cleanText(value);
  if (value === '') return '';
  const layouts: RegExp[] = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, // RFC3339
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: [+-]\d{4})?$/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:?\d{2}$/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    /^\d{4}-\d{2}-\d{2}$/,
  ];
  for (const layout of layouts) {
    if (!layout.test(value)) continue;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const m = value.match(DATE_RE);
  if (m) {
    const d = new Date(`${m[0]}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

/** 提取密码（URL 参数优先，其次正文中的提取码文案） */
function extractPassword(raw: string): string {
  for (const re of PASSWORD_RES) {
    const m = raw.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

/** 网盘域名 → 链接类型（未知返回 ''，即丢弃） */
function cloudType(u: URL): string {
  const host = u.hostname.toLowerCase();
  const table: Record<string, string> = {
    'pan.quark.cn': 'quark',
    'pan.baidu.com': 'baidu',
    'yun.baidu.com': 'baidu',
    'alipan.com': 'aliyun',
    'www.alipan.com': 'aliyun',
    'drive.uc.cn': 'uc',
    'cloud.189.cn': 'tianyi',
    'caiyun.139.com': 'mobile',
    '115.com': '115',
    '115cdn.com': '115',
    '123pan.com': '123',
    'www.123pan.com': '123',
    'pan.xunlei.com': 'xunlei',
    'mypikpak.com': 'pikpak',
    'www.mypikpak.com': 'pikpak',
  };
  return table[host] ?? '';
}

/** 提取资源页所有链接：a[href] → 正文 magnet → 正文 URL → Hash 标签兜底 */
function extractLinks($: cheerio.CheerioAPI): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  const documentText = $.root().text();

  const add = (rawInput: string) => {
    // Go strings.Trim(raw, "'\"<>),.;")：去除首尾该字符集合
    let raw = rawInput.trim().replace(/^['"<>),.;]+/, '').replace(/['"<>),.;]+$/, '');
    if (raw === '') return;
    if (raw.toLowerCase().startsWith('magnet:?')) {
      if (seen.has(raw)) return;
      seen.add(raw);
      links.push({ type: 'magnet', url: raw, password: '' });
      return;
    }
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const linkType = cloudType(u);
    if (linkType === '') return;
    let password = extractPassword(raw);
    if (password === '') password = extractPassword(documentText);
    const key = `${raw}\x00${password}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ type: linkType, url: raw, password });
  };

  $('a[href]').each((_i, s) => add($(s).attr('href') ?? ''));
  for (const raw of documentText.match(MAGNET_RE) ?? []) add(raw);
  for (const raw of documentText.match(URL_RE) ?? []) add(raw);
  if (links.length === 0) {
    const hash = labeledValue($, 'Hash').trim();
    if (HASH_RE.test(hash)) add(`magnet:?xt=urn:btih:${hash.toLowerCase()}`);
  }
  return links;
}

/** 解析搜索列表：.module-items .module-item → 影视条目 */
function parseSearchItems($: cheerio.CheerioAPI): SearchItem[] {
  const items: SearchItem[] = [];
  const seen = new Set<string>();
  $('.module-items .module-item').each((_i, s) => {
    let anchor = $(s).find('.module-item-title[href]').first();
    if (anchor.length === 0) anchor = $(s).find("a[href*='/detail/']").first();
    const href = absoluteURL(anchor.attr('href') ?? '');
    if (href === '' || !href.includes('/detail/')) return;
    if (seen.has(href)) return;
    let title = cleanText(anchor.attr('title') ?? '');
    if (title === '') title = cleanText(anchor.text());
    if (title === '') return;
    seen.add(href);
    const item: SearchItem = {
      id: detailID(href),
      title,
      detailURL: href,
      description: cleanText($(s).find('.video-text').first().text()),
      image: imageURL($(s).find('img').first()),
      tags: [],
    };
    s.find('.module-item-caption span').each((_j, tag) => {
      const value = cleanText($(tag).text());
      if (value !== '') item.tags.push(value);
    });
    items.push(item);
  });
  return items;
}

/** 抓取影视详情页：标题/简介/封面/标签 + 资源列表（磁力优先、网盘其次） */
async function fetchMovie(item: SearchItem): Promise<MovieDetail> {
  const html = await fetchDocument(item.detailURL, `${BASE_URL}/`);
  const $ = cheerio.load(html);
  const detail: MovieDetail = {
    title: cleanText($('.video-info-header > h1.page-title').first().text()),
    description: cleanText($('.vod_content').first().text()),
    image: imageURL($('.video-cover img').first()),
    tags: [...item.tags],
    resources: [],
    datetime: new Date().toISOString(),
  };
  if (detail.title === '') detail.title = item.title;
  if (detail.description === '') detail.description = item.description;
  if (detail.image === '') detail.image = item.image;
  if (detail.tags.length === 0) {
    $('.video-info-aux a').each((_i, s) => {
      const value = cleanText($(s).text());
      if (value !== '' && value !== 'Movie') detail.tags.push(value);
    });
  }

  const seen = new Set<string>();
  const torrentResources: ResourceItem[] = [];
  const cloudResources: ResourceItem[] = [];
  $('.module-row-info a.module-row-text[href]').each((_i, s) => {
    const href = absoluteURL($(s).attr('href') ?? '');
    if (href === '' || (!href.includes('/tdown/') && !href.includes('/pdown/'))) return;
    if (seen.has(href)) return;
    const isCloud = href.includes('/pdown/');
    if (isCloud && cloudResources.length >= MAX_CLOUD_RESOURCES) return;
    if (!isCloud && torrentResources.length >= MAX_RESOURCES_PER_MOVIE) return;
    seen.add(href);
    let title = cleanResourceTitle($(s).find('.module-row-title h4').first().text());
    if (title === '') title = cleanResourceTitle($(s).attr('title') ?? '');
    if (title === '') title = detail.title;
    const resource: ResourceItem = { id: resourceID(href), title, url: href };
    if (isCloud) cloudResources.push(resource);
    else torrentResources.push(resource);
  });
  detail.resources = [...torrentResources, ...cloudResources];
  return detail;
}

/** 抓取资源下载页并组装 SearchResult */
async function fetchResource(movie: MovieDetail, item: ResourceItem): Promise<SearchResult | null> {
  const html: string = await fetchDocument(item.url, `${BASE_URL}/`);
  const $ = cheerio.load(html);
  let resourceTitle = cleanResourceTitle($('.tinfo .page-title').first().text());
  if (resourceTitle === '') resourceTitle = item.title;
  if (resourceTitle === '') resourceTitle = movie.title;

  const links = extractLinks($);
  if (links.length === 0) return null;

  let datetime = parseDateValue(labeledValue($, '更新时间'));
  if (datetime === '') datetime = parseDateValue(labeledValue($, '种子时间'));
  if (datetime === '') datetime = movie.datetime;

  let content = movie.description;
  if (content === '') content = '来源：BT影视';
  content += `\n资源：${resourceTitle}`;

  for (const link of links) link.work_title = movie.title;

  const id = item.id !== '' ? item.id : shortHash(item.url);
  const result: SearchResult = {
    message_id: `${PLUGIN_NAME}-${id}`,
    unique_id: `${PLUGIN_NAME}-${id}`,
    channel: '',
    datetime,
    title: resourceTitle,
    content,
    tags: ['BT影视', ...movie.tags],
    links,
  };
  if (movie.image !== '') result.images = [movie.image];
  return result;
}

export const btbtlb = definePlugin({
  name: PLUGIN_NAME,
  priority: 3,
  skipServiceFilter: true, // 种子名常用点分隔：插件内部过滤，跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    const html = await fetchDocument(`${BASE_URL}/search/${encodeURIComponent(kw)}`, `${BASE_URL}/`);
    let items = parseSearchItems(cheerio.load(html));
    if (items.length > MAX_SEARCH_ITEMS) items = items.slice(0, MAX_SEARCH_ITEMS);
    if (items.length === 0) return [];

    // 影视页相互独立，限流并发抓取（Go semaphore 4）
    const movieLimit = createLimiter(MAX_MOVIE_CONCURRENCY);
    const movieDetails = await Promise.all(
      items.map((item) =>
        movieLimit(async () => {
          try {
            const detail = await fetchMovie(item);
            return detail.resources.length > 0 ? detail : null;
          } catch {
            return null;
          }
        }),
      ),
    );
    const movies = movieDetails.filter((m): m is MovieDetail => m !== null);
    if (movies.length === 0) return [];

    // 收集资源候选（按影视顺序，去重，上限 40）
    const resources: Array<{ movie: MovieDetail; item: ResourceItem }> = [];
    const seenResource = new Set<string>();
    for (const movie of movies) {
      for (const resource of movie.resources) {
        if (seenResource.has(resource.url)) continue;
        seenResource.add(resource.url);
        resources.push({ movie, item: resource });
        if (resources.length >= MAX_RESOURCE_ITEMS) break;
      }
      if (resources.length >= MAX_RESOURCE_ITEMS) break;
    }
    if (resources.length === 0) return [];

    // 限流并发解析资源页（Go semaphore 8）
    const resourceLimit = createLimiter(MAX_RESOURCE_CONCURRENCY);
    const resolved = await Promise.all(
      resources.map(({ movie, item }) =>
        resourceLimit(async () => {
          try {
            return await fetchResource(movie, item);
          } catch {
            return null;
          }
        }),
      ),
    );

    const results = resolved.filter((r): r is SearchResult => r !== null && r.links.length > 0);
    return filterResultsByKeyword(results, kw);
  },
});
