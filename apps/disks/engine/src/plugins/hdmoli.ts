// HDmoli（hdmoli.com）网盘插件 —— Go plugin/hdmoli 的复刻
// 契约：GET /search.php?searchkey=<kw>&submit=（需 Referer）→ #searchList 列表
// → 并发抓详情页，在 .downlist 的「夸克/百度」段落中提取网盘链接。
// 需要设置 Referer（Go 注释：HDmoli 需要设置 referer）。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://www.hdmoli.com';
const SEARCH_PATH = '/search.php?searchkey=%s&submit=';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 50;
const MAX_CONCURRENCY = 20;
const REQUEST_TIMEOUT = 30_000;
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 详情页缓存 30 分钟

const SEARCH_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  Referer: `${BASE_URL}/`, // HDmoli 需要设置 Referer
};

const DETAIL_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: `${BASE_URL}/`,
};

async function httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    return { status: resp.status, body: await resp.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的请求：3 次尝试、指数退避 200ms*2^(i-1)（Go doRequestWithRetry） */
async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
    try {
      const { status, body } = await httpGet(url, headers);
      if (status === 200) return body;
      lastErr = new Error(`HTTP 状态错误: ${status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`[hdmoli] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 从夸克链接 URL 提取提取码（夸克一般不需要，返回空）（Go extractPasswordFromQuarkURL） */
function extractPasswordFromQuarkURL(_panURL: string): string {
  return '';
}

/** 从百度链接 URL 提取提取码（Go extractPasswordFromBaiduURL：?pwd=/&pwd= 后的全部内容） */
function extractPasswordFromBaiduURL(panURL: string): string {
  if (panURL.includes('?pwd=')) {
    const parts = panURL.split('?pwd=');
    if (parts.length > 1) return parts[1];
  }
  if (panURL.includes('&pwd=')) {
    const parts = panURL.split('&pwd=');
    if (parts.length > 1) return parts[1];
  }
  return '';
}

/** 解析详情页 HTML 中的网盘链接（Go parseNetworkDiskLinks） */
function parseNetworkDiskLinks(htmlContent: string): Link[] {
  const links: Link[] = [];

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(htmlContent);
  } catch {
    return parseNetworkDiskLinksWithRegex(htmlContent); // 解析失败走正则备选
  }

  // 在「视频下载」区域查找网盘链接
  $('.downlist').each((_i, el) => {
    $(el)
      .find('p')
      .each((_j, pEl) => {
        const text = $(pEl).text();

        // 夸克网盘
        if (text.includes('夸 克：') || text.includes('夸克：')) {
          $(pEl)
            .find('a')
            .each((_k, a) => {
              const href = $(a).attr('href') ?? '';
              if (href.includes('pan.quark.cn')) {
                links.push({ type: 'quark', url: href, password: extractPasswordFromQuarkURL(href) });
              }
            });
        }

        // 百度网盘
        if (text.includes('百 度：') || text.includes('百度：')) {
          $(pEl)
            .find('a')
            .each((_k, a) => {
              const href = $(a).attr('href') ?? '';
              if (href.includes('pan.baidu.com')) {
                links.push({ type: 'baidu', url: href, password: extractPasswordFromBaiduURL(href) });
              }
            });
        }
      });
  });

  return links;
}

/** 正则解析网盘链接（cheerio 失败时的备选）（Go parseNetworkDiskLinksWithRegex） */
function parseNetworkDiskLinksWithRegex(htmlContent: string): Link[] {
  const links: Link[] = [];

  const quarkMatches = htmlContent.match(/<b>夸\s*克：<\/b><a[^>]*href\s*=\s*["']([^"']*pan\.quark\.cn[^"']*)["'][^>]*>/g) ?? [];
  for (const m of quarkMatches) {
    const sub = m.match(/href\s*=\s*["']([^"']*pan\.quark\.cn[^"']*)["']/);
    if (sub) links.push({ type: 'quark', url: sub[1], password: '' });
  }

  const baiduMatches = htmlContent.match(/<b>百\s*度：<\/b><a[^>]*href\s*=\s*["']([^"']*pan\.baidu\.com[^"']*)["'][^>]*>/g) ?? [];
  for (const m of baiduMatches) {
    const sub = m.match(/href\s*=\s*["']([^"']*pan\.baidu\.com[^"']*)["']/);
    if (sub) links.push({ type: 'baidu', url: sub[1], password: extractPasswordFromBaiduURL(sub[1]) });
  }

  return links;
}

/** 解析搜索结果列表项（Go parseResultItem） */
function parseResultItem($: cheerio.CheerioAPI, el: unknown): SearchResult | null {
  const s = $(el);

  // 标题与详情页链接
  const titleEl = s.find('.detail h4.title a');
  if (titleEl.length === 0) return null; // 跳过无标题链接的结果

  const title = titleEl.text().trim();
  if (title === '') return null;

  let detailURL = titleEl.attr('href') ?? '';
  if (detailURL === '') {
    // 尝试从缩略图获取链接
    detailURL = s.find('.thumb a').attr('href') ?? '';
  }
  if (detailURL === '') return null; // 跳过无链接的结果

  // 相对路径补全
  if (detailURL.startsWith('/')) detailURL = BASE_URL + detailURL;

  // 评分
  const rating = s.find('.pic-tag').text().trim();
  // 更新状态
  const updateStatus = s.find('.pic-text').text().trim();

  // 导演
  let director = '';
  s.find('p').each((_i, pEl) => {
    if (director !== '') return; // 已找到，跳过
    const text = $(pEl).text();
    if (text.includes('导演：')) {
      const parts = text.split('导演：');
      if (parts.length > 1) director = parts[1].trim();
    }
  });

  // 主演
  const actors: string[] = [];
  s.find('p').each((_i, pEl) => {
    const text = $(pEl).text();
    if (text.includes('主演：')) {
      $(pEl)
        .find('a')
        .each((_j, a) => {
          const actor = $(a).text().trim();
          if (actor !== '') actors.push(actor);
        });
    }
  });

  // 分类信息（分类、地区、年份）
  let category = '';
  let region = '';
  let year = '';
  s.find('p').each((_i, pEl) => {
    const text = $(pEl).text();
    if (!text.includes('分类：')) return;
    const parts = text.split('：');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].endsWith('分类') && i + 1 < parts.length) {
        const info = parts[i + 1].trim();
        const infoParts = info.split(/[，,\s]+/);
        if (infoParts.length > 0 && infoParts[0] !== '') category = infoParts[0];
      } else if (parts[i].endsWith('地区') && i + 1 < parts.length) {
        const regionPart = parts[i + 1].trim();
        const regionParts = regionPart.split(/[，,\s]+/);
        if (regionParts.length > 0 && regionParts[0] !== '') region = regionParts[0];
      } else if (parts[i].endsWith('年份') && i + 1 < parts.length) {
        const yearPart = parts[i + 1].trim();
        const yearParts = yearPart.split(/[，,\s]+/);
        if (yearParts.length > 0 && yearParts[0] !== '') year = yearParts[0];
      }
    }
  });

  // 简介
  let description = '';
  s.find('p.hidden-xs').each((_i, pEl) => {
    if (description !== '') return; // 已找到，跳过
    const text = $(pEl).text();
    if (text.includes('简介：')) {
      const parts = text.split('简介：');
      if (parts.length > 1) {
        let desc = parts[1].trim();
        if (desc.length > 200) desc = desc.slice(0, 200) + '...'; // 限制长度
        description = desc;
      }
    }
  });

  // 构建内容
  const contentParts: string[] = [];
  if (rating !== '') contentParts.push(`评分：${rating}`);
  if (updateStatus !== '') contentParts.push(`状态：${updateStatus}`);
  if (director !== '') contentParts.push(`导演：${director}`);
  if (actors.length > 0) {
    let actorStr = actors.join(' ');
    if (actorStr.length > 100) actorStr = actorStr.slice(0, 100) + '...';
    contentParts.push(`主演：${actorStr}`);
  }
  if (category !== '') contentParts.push(`分类：${category}`);
  if (region !== '') contentParts.push(`地区：${region}`);
  if (year !== '') contentParts.push(`年份：${year}`);
  if (description !== '') contentParts.push(`简介：${description}`);

  const tags = [category, region, year].filter((t) => t !== '');

  // 稳定 ID：优先取 URL 路径（Go：url.Parse 后取 Path）
  let itemID = detailURL;
  try {
    itemID = new URL(detailURL).pathname;
  } catch {
    /* 解析失败保留完整 URL */
  }
  const stableID = `hdmoli-${encodeURIComponent(itemID.replace(/^\/+|\/+$/g, ''))}`;

  const content = [...contentParts, `详情页URL: ${detailURL}`].join('\n');
  return {
    title,
    content, // 详情页 URL 暂存于 Content，抓取后清除
    channel: '', // 插件搜索结果必须为空字符串
    message_id: stableID,
    unique_id: stableID,
    datetime: new Date().toISOString(), // 搜索结果页没有明确时间，使用当前时间
    links: [], // 先为空，详情页处理后添加
    tags,
  };
}

/** 从 Content 中提取详情页 URL（Go extractDetailURLFromContent） */
function extractDetailURLFromContent(content: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('详情页URL: ')) return line.slice('详情页URL: '.length);
  }
  return '';
}

/** 清理 Content，移除详情页 URL 行（Go cleanContent） */
function cleanContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('详情页URL: '))
    .join('\n');
}

// 详情页缓存（模块级，读取时校验 TTL）
const detailCache = new Map<string, { links: Link[]; timestamp: number }>();

/** 获取详情页的网盘链接（Go fetchDetailPageLinks；失败返回空） */
async function fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
  const cached = detailCache.get(detailURL);
  if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) return cached.links;

  try {
    const { status, body } = await httpGet(detailURL, DETAIL_HEADERS);
    if (status !== 200) return [];
    const links = parseNetworkDiskLinks(body);
    if (links.length > 0) detailCache.set(detailURL, { links, timestamp: Date.now() });
    return links;
  } catch {
    return [];
  }
}

export const hdmoli = definePlugin({
  name: 'hdmoli',
  priority: 2, // 标准网盘插件（Go NewBaseAsyncPlugin("hdmoli", 2)），启用 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 第一步：执行搜索获取结果列表
    const searchURL = BASE_URL + SEARCH_PATH.replace('%s', encodeURIComponent(keyword));
    const html = await fetchWithRetry(searchURL, SEARCH_HEADERS);

    const $ = cheerio.load(html);
    const searchResults: SearchResult[] = [];
    $('#searchList > li.active.clearfix').each((_i, el) => {
      if (searchResults.length >= MAX_RESULTS) return;
      const result = parseResultItem($, el);
      if (result !== null) searchResults.push(result);
    });

    // 第二步：并发获取详情页链接
    const limit = createLimiter(MAX_CONCURRENCY);
    const finalResults = (
      await Promise.all(
        searchResults.map(async (r) => {
          const detailURL = extractDetailURLFromContent(r.content);
          if (detailURL === '') return null; // 跳过无详情页 URL 的结果
          const links = await limit(() => fetchDetailPageLinks(detailURL));
          if (links.length === 0) return null; // 详情页无有效链接
          return { ...r, links, content: cleanContent(r.content) };
        }),
      )
    ).filter((r): r is SearchResult => r !== null);

    // 第三步：关键词过滤（标准网盘插件需要过滤）
    return filterResultsByKeyword(finalResults, keyword);
  },
});
