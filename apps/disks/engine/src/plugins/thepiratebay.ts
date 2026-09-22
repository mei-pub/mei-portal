// ThePirateBay 磁力搜索插件 —— Go plugin/thepiratebay 的复刻（磁力源，跳过 Service 层过滤）
// 站点 thpibay.xyz，支持分页并发抓取（上限 30 页）。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const SITE_URL = 'https://thpibay.xyz';
const DEFAULT_TIMEOUT_MS = 10_000; // Go DefaultTimeout
const MAX_CONCURRENCY = 200; // Go MaxConcurrency（信号量）
const MAX_PAGES = 30; // 最大分页数（避免无限请求）

// 预编译正则（原样搬运）
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/;
const TORRENT_ID_REGEX = /\/torrent\/(\d+)\//;
const TIME_FORMAT1_REGEX = /(\d{2}-\d{2})\s+(\d{2}:\d{2})/; // MM-DD HH:MM
const TIME_FORMAT2_REGEX = /(\d{2}-\d{2})\s+(\d{4})/; // MM-DD YYYY
const FILE_SIZE_REGEX = /Size\s+([0-9.]+)\s*(&nbsp;)?\s*([KMGT]?i?B)/;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  Referer: 'https://thpibay.xyz/',
};

/**
 * 带重试的抓取（Go doRequestWithRetry）：3 次尝试，非 200 也重试，
 * 退避 200ms * 2^(i-1)；整个重试过程共享同一超时（Go 的 ctx 跨克隆请求生效）。
 */
async function fetchPageWithRetry(searchURL: string, page: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
      try {
        const resp = await fetch(searchURL, { headers: REQUEST_HEADERS, signal: controller.signal });
        if (resp.status === 200) return await resp.text();
        lastErr = new Error(`[thepiratebay] 第${page}页请求返回状态码: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`[thepiratebay] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 解析总页数（Go parseTotalPages） */
function parseTotalPages($: cheerio.CheerioAPI): number {
  let maxPage = 1;
  // 分页在表格之后：/search/keyword/PAGE/99/0
  $('table#searchResult')
    .next()
    .find('a')
    .each((_i, a) => {
      const href = $(a).attr('href') ?? '';
      const parts = href.split('/');
      if (parts.length >= 4 && parts[3] !== '') {
        const pageNum = parseInt(parts[3], 10);
        if (!Number.isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
      }
    });
  // 分页导航区域
  $("td[colspan='9'] a").each((_i, a) => {
    const pageNum = parseInt($(a).text().trim(), 10);
    if (!Number.isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
  });
  if (maxPage > MAX_PAGES) maxPage = MAX_PAGES;
  return maxPage;
}

/** 解析上传时间（Go parseUploadTime）：MM-DD HH:MM（当年）/ MM-DD YYYY（历史），失败取当前时间 */
function parseUploadTime(detDesc: string): string {
  const timeStr = detDesc.replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ');
  const m1 = timeStr.match(TIME_FORMAT1_REGEX);
  if (m1) {
    const currentYear = new Date().getFullYear();
    const t = new Date(`${currentYear}-${m1[1]}T${m1[2]}:00Z`);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  const m2 = timeStr.match(TIME_FORMAT2_REGEX);
  if (m2) {
    const t = new Date(`${m2[2]}-${m2[1]}T00:00:00Z`);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return new Date().toISOString();
}

/** 解析单个搜索结果项（Go parseSearchResultItem） */
function parseSearchResultItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<never>): SearchResult | null {
  // 详情页链接和标题
  const titleElement = s.find('.detName a.detLink').first();
  if (titleElement.length === 0) return null;

  let title = titleElement.text().trim();
  if (title === '') return null;
  // 优化标题格式：将'.'替换为空格，便于关键词匹配
  title = title.replace(/\./g, ' ');

  let detailURL = titleElement.attr('href') ?? '';
  if (detailURL === '') return null;
  if (detailURL.startsWith('/')) detailURL = SITE_URL + detailURL;

  // 提取种子ID
  const idMatch = detailURL.match(TORRENT_ID_REGEX);
  if (!idMatch) return null;

  // 磁力链接（没有磁力链接就跳过）
  const magnetURL = s.find("a[href^='magnet:']").first().attr('href');
  if (!magnetURL || magnetURL === '') return null;
  if (!MAGNET_LINK_REGEX.test(magnetURL)) return null;

  // 分类
  const tags: string[] = [];
  s.find('.vertTh a').each((_i, el) => {
    const tag = $(el).text().trim();
    if (tag !== '') tags.push(tag);
  });

  // 种子元数据（文件大小、上传时间、上传者等）
  const detDesc = s.find('.detDesc').text();
  const datetime = parseUploadTime(detDesc);

  let content = '';
  const sizeMatch = detDesc.match(FILE_SIZE_REGEX);
  if (sizeMatch) content = `文件大小: ${sizeMatch[1]}${sizeMatch[3]}`;
  if (content !== '') content += ', ';
  content += `上传信息: ${detDesc.trim()}`;

  // Seeders / Leechers
  const seeders = s.find('td').eq(2).text().trim();
  const leechers = s.find('td').eq(3).text().trim();
  if (seeders !== '' && leechers !== '') {
    content += `, Seeders: ${seeders}, Leechers: ${leechers}`;
  }

  return {
    message_id: '',
    unique_id: `thepiratebay-${idMatch[1]}`,
    channel: '', // 插件搜索结果，Channel 必须为空
    datetime,
    title,
    content,
    links: [{ type: 'magnet', url: magnetURL, password: '' }],
    tags,
  };
}

/** 搜索指定页面（Go searchPage） */
async function searchPage(encodedKeyword: string, page: number): Promise<{ results: SearchResult[]; totalPages: number }> {
  const searchURL =
    page === 1
      ? `https://thpibay.xyz/search/${encodedKeyword}/1/99/0`
      : `https://thpibay.xyz/search/${encodedKeyword}/${page}/99/0`;

  const html = await fetchPageWithRetry(searchURL, page);
  const $ = cheerio.load(html);

  // 分页信息只在第一页解析
  let totalPages = 1;
  if (page === 1) totalPages = parseTotalPages($);

  const results: SearchResult[] = [];
  $('table#searchResult tr').each((_i, row) => {
    const s = $(row);
    if (s.hasClass('header')) return; // 跳过表头
    const result = parseSearchResultItem($, s);
    if (result) results.push(result);
  });

  return { results, totalPages };
}

export const thepiratebay = definePlugin({
  name: 'thepiratebay',
  priority: 3,
  skipServiceFilter: true, // 磁力搜索插件：宽泛结果（Go NewBaseAsyncPluginWithFilter 第3参 true）
  async search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 支持英文搜索优化（ext.title_en）
    let searchKeyword = keyword;
    const titleEn = ext['title_en'];
    if (typeof titleEn === 'string' && titleEn !== '') searchKeyword = titleEn;

    const encodedKeyword = encodeURIComponent(searchKeyword);

    // 1. 搜索第一页，获取总页数
    const first = await searchPage(encodedKeyword, 1);
    const allResults = [...first.results];

    // 2. 并发搜索其他页面（限制最大页数）
    const maxPagesToSearch = Math.min(first.totalPages, MAX_PAGES);
    if (first.totalPages > 1 && maxPagesToSearch > 1) {
      const limit = createLimiter(MAX_CONCURRENCY); // Go semaphore
      const pages: number[] = [];
      for (let page = 2; page <= maxPagesToSearch; page++) pages.push(page);
      // 按页码顺序合并所有页面的结果
      const pageResults = await Promise.all(
        pages.map(async (pageNum) => {
          try {
            const r = await limit(() => searchPage(encodedKeyword, pageNum));
            return r.results;
          } catch {
            return []; // Go：单页失败静默丢弃
          }
        }),
      );
      for (const results of pageResults) allResults.push(...results);
    }

    // 3. 按处理后的搜索关键词过滤（标题中的'.'已替换为空格，提高匹配准确度）
    return filterResultsByKeyword(allResults, searchKeyword);
  },
});
