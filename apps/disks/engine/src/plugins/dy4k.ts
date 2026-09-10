// 4K 电影（4kdy.vip）插件 —— Go plugin/dy4k 的复刻
// 契约：/4K-search/-------------.html?wd=<kw>（分页 &page=N）→ 列表卡片
// a[href*='/4K-detail/'] → 详情页 /4K-detail/<id>.html 内提取磁力/电驴/网盘链接。
// 注：Go 版的代理配置（默认关闭）、调试日志、性能统计、HTML 落盘为调试设施，
// 均不移植；详情页缓存保留（TTL 1 小时，读取时校验，等价于 Go 的后台定时删除）。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://4kdy.vip';
const SEARCH_URL = `${BASE_URL}/4K-search/-------------.html?wd=`;
const SEARCH_PAGE_URL = `${BASE_URL}/4K-search/-------------.html?wd=`;
const DETAIL_URL = `${BASE_URL}/4K-detail/%s.html`;

const DEFAULT_TIMEOUT = 15_000;
const MAX_CONCURRENCY = 6; // 详情页并发
const MAX_PAGES = 10; // 最大分页数
const DETAIL_CACHE_TTL = 60 * 60 * 1000; // 1 小时

const DETAIL_ID_REGEX = /\/4K-detail\/(\d+)\.html/;
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/;
const ED2K_LINK_REGEX = /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[^|]+\|\/?/;
const YEAR_REGEX = /\d{4}/;

// 网盘链接正则（Go map 迭代顺序随机；TS 用固定数组顺序，行为更确定）
const PAN_LINK_REGEXES: Array<[string, RegExp]> = [
  ['quark', /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z_-]+(?:\?[^"'\s]*)?/],
  ['baidu', /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?(?:&v=\d+)?/],
  ['aliyun', /https?:\/\/(?:www\.)?alipan\.com\/s\/[0-9a-zA-Z_-]+/],
  ['tianyi', /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z_-]+(?:\([^)]*\))?/],
  ['uc', /https?:\/\/drive\.uc\.cn\/s\/[0-9a-fA-F]+(?:\?[^"\s]*)?/],
  ['mobile', /https?:\/\/caiyun\.139\.com\/[^"\s]+/],
  ['115', /https?:\/\/115\.com\/s\/[0-9a-zA-Z_-]+/],
  ['pikpak', /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z_-]+/],
  ['xunlei', /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/],
  ['123', /https?:\/\/(?:www\.)?123pan\.com\/s\/[0-9a-zA-Z_-]+/],
];

// 密码提取正则（按序尝试）
const PASSWORD_REGEXES = [
  /\?pwd=([0-9a-zA-Z]+)/, // URL中的pwd参数
  /提取码[：:]\s*([0-9a-zA-Z]+)/, // 提取码：xxxx
  /访问码[：:]\s*([0-9a-zA-Z]+)/, // 访问码：xxxx
  /密码[：:]\s*([0-9a-zA-Z]+)/, // 密码：xxxx
  /（访问码[：:]\s*([0-9a-zA-Z]+)）/, // （访问码：xxxx）
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** 生成随机私有网段 IP（Go generateRandomIP） */
function generateRandomIP(): string {
  const ri = (n: number) => Math.floor(Math.random() * n);
  const segments = [
    [192, 168, ri(256), ri(256)],
    [10, ri(256), ri(256), ri(256)],
    [172, 16 + ri(16), ri(256), ri(256)],
  ];
  return segments[ri(segments.length)].join('.');
}

function matchAll(text: string, pattern: RegExp): string[] {
  return text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? [];
}

async function httpGet(url: string, headers: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    return { status: resp.status, body: await resp.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** 搜索页请求：3 次尝试、指数退避 200ms*2^(i-1)，非 200 也重试（Go doRequestWithRetry） */
async function fetchSearchPage(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
    try {
      const randomIP = generateRandomIP();
      const { status, body } = await httpGet(url, {
        'User-Agent': getRandomUA(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        Referer: `${BASE_URL}/`,
        'X-Forwarded-For': randomIP,
        'X-Real-IP': randomIP,
        'sec-ch-ua-platform': 'macOS',
      });
      if (status === 200) return body;
      lastErr = new Error(`状态码 ${status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`[dy4k] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 解析总页数：.hl-page-tips a 文本形如 "1 / 2"（Go parseTotalPages） */
function parseTotalPages($: cheerio.CheerioAPI): number {
  const pageInfo = $('.hl-page-tips a').text();
  if (pageInfo === '') return 1;
  const parts = pageInfo.split('/');
  if (parts.length !== 2) return 1;
  const totalPages = Number.parseInt(parts[1].trim(), 10);
  if (!Number.isInteger(totalPages) || totalPages < 1) return 1;
  return totalPages;
}

interface DetailPageResponse {
  title: string;
  imageURL: string;
  downloads: Link[];
  tags: string[];
  content: string;
}

function addDownloadLink(detail: DetailPageResponse, linkType: string, linkURL: string, password: string): void {
  if (linkURL === '') return;
  if (detail.downloads.some((l) => l.url === linkURL)) return; // 已存在
  detail.downloads.push({ type: linkType, url: linkURL, password, work_title: detail.title });
}

/** 从链接 URL 本身提取密码（Go extractPasswordFromLink） */
function extractPasswordFromLink(link: string): string {
  for (const regex of PASSWORD_REGEXES) {
    const m = link.match(regex);
    if (m && m.length > 1) return m[1];
  }
  return '';
}

/** 从链接及周围文本提取密码（Go extractPasswordFromText） */
function extractPasswordFromText(text: string, link: string): string {
  const password = extractPasswordFromLink(link);
  if (password !== '') return password;
  for (const regex of PASSWORD_REGEXES) {
    const m = text.match(regex);
    if (m && m.length > 1) return m[1];
  }
  return '';
}

/** 处理单个找到的链接（Go processFoundLink） */
function processFoundLink(detail: DetailPageResponse, link: string, contextText: string): void {
  link = link.trim();
  if (link === '') return;

  const magnet = link.match(MAGNET_LINK_REGEX)?.[0];
  if (magnet) {
    addDownloadLink(detail, 'magnet', magnet, '');
    return;
  }
  const ed2k = link.match(ED2K_LINK_REGEX)?.[0];
  if (ed2k) {
    addDownloadLink(detail, 'ed2k', ed2k, '');
    return;
  }
  for (const [panType, regex] of PAN_LINK_REGEXES) {
    const matched = link.match(regex)?.[0];
    if (!matched) continue;
    const password = extractPasswordFromText(contextText, matched);
    addDownloadLink(detail, panType, matched, password);
    return;
  }
}

/** 从整段文本提取各类型链接（Go extractLinksFromText） */
function extractLinksFromText(detail: DetailPageResponse, text: string): void {
  for (const magnetLink of matchAll(text, MAGNET_LINK_REGEX)) addDownloadLink(detail, 'magnet', magnetLink, '');
  for (const ed2kLink of matchAll(text, ED2K_LINK_REGEX)) addDownloadLink(detail, 'ed2k', ed2kLink, '');

  for (const [panType, regex] of PAN_LINK_REGEXES) {
    for (const panLink of matchAll(text, regex)) {
      const password = extractPasswordFromText(text, panLink);
      addDownloadLink(detail, panType, panLink, password);
    }
  }
}

/** 提取详情页中的磁力、电驴和网盘链接（Go extractDownloadLinks） */
function extractDownloadLinks($: cheerio.CheerioAPI, detail: DetailPageResponse): void {
  // 新版下载列表与旧版列表都通过 a[href] 提取，链接旁的文本用于补充提取码
  $('.download-item a[href], .hl-downs-list a[href], .hl-rb-playlist a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (href.trim() === '') return;
    const itemText = $(el).parent().text().trim();
    processFoundLink(detail, href, itemText);
  });

  // 兼容链接直接出现在页面文本中的旧模板
  extractLinksFromText(detail, $.root().text());
}

// 详情页缓存（模块级，读取时校验 TTL）
const detailCache = new Map<string, { detail: DetailPageResponse; timestamp: number }>();

/** 获取并解析详情页（Go getDetailInfo；失败返回 null） */
async function getDetailInfo(id: string): Promise<DetailPageResponse | null> {
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) return cached.detail;

  try {
    const { status, body } = await httpGet(DETAIL_URL.replace('%s', id), {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Connection: 'keep-alive',
      Referer: `${BASE_URL}/`,
    });
    if (status !== 200) return null;

    const $ = cheerio.load(body);
    const detail: DetailPageResponse = { title: '', imageURL: '', downloads: [], tags: [], content: '' };

    // 标题
    detail.title = $('h1.title-mobile').first().text().trim();
    if (detail.title === '') detail.title = $('h2.hl-dc-title').first().text().trim();

    // 封面
    let imgEl = $('.info-card-mobile img[data-original]').first();
    if (imgEl.length === 0) imgEl = $('.hl-dc-pic .hl-item-thumb').first();
    const imageURL = imgEl.attr('data-original');
    if (imageURL !== undefined && imageURL !== '') {
      detail.imageURL = imageURL.startsWith('/') ? BASE_URL + imageURL : imageURL;
    }

    // 剧情简介
    detail.content = $('.info-card-mobile').first().find("[class*='leading-relaxed']").first().text().trim();
    if (detail.content === '') detail.content = $('.hl-content-wrap .hl-content-text').first().text().trim();

    // 详细信息作为标签（类型:/地区:/语言:）
    $('.hl-vod-data ul li').each((_i, el) => {
      let text = $(el).text().trim();
      if (text !== '') {
        text = text.replace(/：/g, ': ');
        if (text.includes('类型:') || text.includes('地区:') || text.includes('语言:')) detail.tags.push(text);
      }
    });

    // 下载链接
    extractDownloadLinks($, detail);

    detailCache.set(id, { detail, timestamp: Date.now() });
    return detail;
  } catch {
    return null;
  }
}

/** 解析新版搜索页结果卡片（Go extractNewSearchResults） */
function extractNewSearchResults($: cheerio.CheerioAPI): SearchResult[] {
  const results: SearchResult[] = [];
  const container = $('div.space-y-4').first();
  if (container.length === 0) return results;

  container.find("a[href*='/4K-detail/']").each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (href === '') return;
    const matches = href.match(DETAIL_ID_REGEX);
    if (!matches) return;

    const card = $(el).parent().parent();
    if (card.length === 0 || card.find("a[href^='/4K-vodplay/']").length === 0) return;

    const title = $(el).text().trim();
    if (title === '') return;

    const image = card.find('img').first();
    let imageURL = image.attr('data-original') ?? '';
    if (imageURL === '') imageURL = image.attr('src') ?? '';
    if (imageURL.startsWith('/')) imageURL = BASE_URL + imageURL;

    const meta = card.find('div.gap-x-3').first().text().trim();
    const status = card.find("a[href^='/4K-vodplay/'] span").last().text().trim();
    const description = card.find('p').first().text().trim();
    let content = meta;
    if (description !== '') {
      if (content !== '') content += '\n';
      content += description;
    }
    if (status !== '') {
      if (content !== '') content += ' | ';
      content += status;
    }

    results.push({
      message_id: '',
      unique_id: `dy4k-${matches[1]}`,
      channel: '',
      datetime: new Date().toISOString(),
      title,
      content,
      images: imageURL === '' ? undefined : [imageURL],
      links: [], // 详情页阶段填充
    });
  });
  return results;
}

/** cheerio 选中集类型（避免直接依赖 domhandler 类型导出） */
type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

/** 解析旧版 .hl-list-item 结果卡片（Go parseSearchResultItem） */
function parseLegacyResultItem(s: CheerioSelection, name: string): SearchResult | null {
  const href = s.find('.hl-item-pic a').first().attr('href') ?? '';
  if (href === '') return null;
  const fullHref = href.startsWith('/') ? BASE_URL + href : href;
  const matches = fullHref.match(DETAIL_ID_REGEX);
  if (!matches) return null;
  const id = matches[1];

  const title = s.find('.hl-item-title a').first().text().trim();
  if (title === '') return null;

  let imageURL = s.find('.hl-item-thumb').attr('data-original') ?? '';
  if (imageURL !== '' && imageURL.startsWith('/')) imageURL = BASE_URL + imageURL;

  const status = s.find('.hl-pic-text .remarks').text().trim();
  const score = s.find('.hl-text-conch.score').text().trim();
  const basicInfo = s.find('.hl-item-sub').first().text().trim();
  const description = s.find('.hl-item-sub').last().text().trim();

  // 解析年份、地区、类型
  let year = '';
  let region = '';
  let category = '';
  if (basicInfo !== '') {
    const parts = basicInfo.split('·');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part === '') continue;
      if (score !== '' && part.includes(score)) continue; // 跳过评分
      if (i === 0 || (i === 1 && parts[0].includes(score))) {
        if (YEAR_REGEX.test(part)) year = part;
      } else if (region === '') {
        region = part;
      } else if (category === '') {
        category = part;
      } else {
        category += ' ' + part;
      }
    }
  }

  const tags: string[] = [];
  if (status !== '') tags.push(status);
  if (year !== '') tags.push(year);
  if (region !== '') tags.push(region);
  if (category !== '') tags.push(category);

  let content = description;
  if (basicInfo !== '') content = `${basicInfo}\n${description}`;
  if (score !== '') content = `评分: ${score}\n${content}`;

  return {
    message_id: '',
    unique_id: `${name}-${id}`,
    channel: '',
    datetime: '', // Go 使用零值时间
    title,
    content,
    tags,
    links: [], // 初始为空，详情页阶段填充
  };
}

/** 搜索指定页并解析列表（Go searchPage） */
async function searchPage(encodedKeyword: string, page: number): Promise<{ results: SearchResult[]; totalPages: number }> {
  const searchURL = page === 1 ? `${SEARCH_URL}${encodedKeyword}` : `${SEARCH_PAGE_URL}${encodedKeyword}&page=${page}`;
  const html = await fetchSearchPage(searchURL);
  const $ = cheerio.load(html);

  const totalPages = parseTotalPages($);
  const results: SearchResult[] = [];
  const legacyItems = $('.hl-list-item');
  if (legacyItems.length > 0) {
    legacyItems.each((_i, el) => {
      const result = parseLegacyResultItem($(el), 'dy4k');
      if (result !== null) results.push(result);
    });
  } else {
    results.push(...extractNewSearchResults($));
  }
  return { results, totalPages };
}

/** 并发抓详情页补全链接（Go enrichWithDetailInfo；无链接的结果被过滤） */
async function enrichWithDetailInfo(results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const limit = createLimiter(MAX_CONCURRENCY);
  const enriched = await Promise.all(
    results.map(async (result) => {
      const parts = result.unique_id.split('-');
      if (parts.length < 2) return result;
      const id = parts[parts.length - 1];

      const detailInfo = await limit(() => getDetailInfo(id));
      if (detailInfo) {
        result.links = detailInfo.downloads;
        if (detailInfo.content !== '') result.content = detailInfo.content;
        // 补充标签（去重）
        const tags = result.tags ?? [];
        for (const tag of detailInfo.tags) {
          if (!tags.includes(tag)) tags.push(tag);
        }
        result.tags = tags;
      }
      return result;
    }),
  );
  return enriched.filter((r) => r.links.length > 0);
}

export const dy4k = definePlugin({
  name: 'dy4k',
  priority: 3, // Go NewBaseAsyncPlugin("dy4k", 3)
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const encodedKeyword = encodeURIComponent(keyword);

    // 第一页获取总页数
    const { results: firstPageResults, totalPages } = await searchPage(encodedKeyword, 1);
    const allResults: SearchResult[] = [...firstPageResults];

    // 并发搜索其余页（上限 MaxPages；Go 对分页搜索无并发限制）
    const maxPagesToSearch = Math.min(totalPages, MAX_PAGES);
    if (totalPages > 1 && maxPagesToSearch > 1) {
      const pageNumbers: number[] = [];
      for (let page = 2; page <= maxPagesToSearch; page++) pageNumbers.push(page);
      const settled = await Promise.allSettled(pageNumbers.map((page) => searchPage(encodedKeyword, page)));
      for (const s of settled) {
        if (s.status === 'fulfilled') allResults.push(...s.value.results);
      }
    }

    // 并发获取详情页信息
    const enriched = await enrichWithDetailInfo(allResults);

    // 关键词过滤（Go：plugin.FilterResultsByKeyword）
    return filterResultsByKeyword(enriched, keyword);
  },
});
