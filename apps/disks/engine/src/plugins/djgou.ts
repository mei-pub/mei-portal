// 短剧狗插件 —— Go plugin/djgou 的复刻
// 站点 duanjugou.top（Z-Blog post-item-row 模板）：搜索列表 → 并发抓详情页提取夸克链接。
// 部分节点先返回 BTWAF JS 跳转页，需跟进 challenge URL 后再解析。

import * as cheerio from 'cheerio';
import { createLimiter, fetchProbe } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

// 超时时间
const DEFAULT_TIMEOUT = 8_000;
const DETAIL_TIMEOUT = 6_000;

// 并发数
const MAX_CONCURRENCY = 15;

// 网站URL
const SITE_URL = 'https://duanjugou.top';

// 夸克网盘链接（站点只有夸克网盘；可能含字母/数字/下划线/连字符）
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z_\-]+/g;
// BTWAF JS 跳转
const BTWAF_URL_REGEX = /window\.location\.href\s*=\s*["']([^"']*btwaf=[^"']+)["']/;
// 提取码
const PWD_REGEX = /提取码[:：]\s*([a-zA-Z0-9]{4})/;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  Referer: SITE_URL,
};

const DETAIL_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_HEADERS['User-Agent'],
  Accept: BROWSER_HEADERS.Accept,
  'Accept-Language': BROWSER_HEADERS['Accept-Language'],
  Referer: SITE_URL,
};

/** 带重试的 GET：成功条件为 HTTP 200（Go doRequestWithRetry，指数退避 200ms/400ms） */
async function doRequestWithRetry(url: string, timeoutMs: number, retries = 3): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
    try {
      const { status, body } = await fetchProbe(url, { timeoutMs, headers: BROWSER_HEADERS });
      if (status === 200) return body;
      lastErr = new Error(`HTTP状态码: ${status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`重试 ${retries} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 解析时间字符串（Go parseTime：无时区格式按 UTC；MM-DD 补当前年份；失败取当前时间） */
function parseTime(timeStr: string): string {
  const now = () => new Date().toISOString();
  if (timeStr === '') return now();
  const s = timeStr.trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    // Go time.Parse 失败（如 2024-99-99）→ 继续尝试后续格式；需校验有效性
    const parsed = new Date(`${s}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  m = s.match(/^(\d{2})-(\d{2})$/);
  if (m) {
    const parsed = new Date(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const formats: Array<[RegExp, string]> = [
    [/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'],
    [/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/, '$1-$2-$3T$4:$5:00Z'],
    [/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2-$3T00:00:00Z'],
    [/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'],
    [/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/, '$1-$2-$3T$4:$5:00Z'],
    [/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3T00:00:00Z'],
  ];
  for (const [re, tpl] of formats) {
    const mm = s.match(re);
    if (mm) {
      const iso = s.replace(re, tpl);
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return now();
}

/** 从整个文档中提取夸克网盘链接（Go extractLinksFromDoc：不限于某个 div） */
function extractLinksFromDoc($: cheerio.CheerioAPI): Link[] {
  const links: Link[] = [];
  const linkMap = new Set<string>();

  // 整页 HTML（关键：从整个页面提取）
  const htmlContent = $.html();

  // 提取提取码
  const password = htmlContent.match(PWD_REGEX)?.[1] ?? '';

  // 方法1：专用正则提取夸克链接
  for (const quarkURL of htmlContent.match(QUARK_LINK_REGEX) ?? []) {
    if (linkMap.has(quarkURL)) continue;
    linkMap.add(quarkURL);
    links.push({ type: 'quark', url: quarkURL, password });
  }

  // 方法2：从所有 <a> 标签中查找夸克链接（补充）
  $('a').each((_i, a) => {
    const href = $(a).attr('href') ?? '';
    if (href === '') return;
    if (href.includes('pan.quark.cn') && !linkMap.has(href)) {
      linkMap.add(href);
      links.push({ type: 'quark', url: href, password });
    }
  });

  return links;
}

/** 提取简介（Go extractContent：折叠空白 + 300 字符截断） */
function extractContent(mainContent: cheerio.Cheerio<any>): string {
  const content = mainContent.text().trim().replace(/\s+/g, ' ');
  return content.length > 300 ? content.slice(0, 300) + '...' : content;
}

interface DetailData {
  links: Link[];
  content: string;
}

/** 抓取详情页（Go fetchDetailPage：失败静默返回空） */
async function fetchDetailPage(detailURL: string): Promise<DetailData | null> {
  let body: string;
  try {
    body = await doRequestWithRetry(detailURL, DETAIL_TIMEOUT);
  } catch {
    return null;
  }

  const $ = cheerio.load(body);
  const links = extractLinksFromDoc($);
  if (links.length === 0) return null;

  // 新模板使用 post-content；旧模板仍兼容 erx-wrap
  let mainContent = $('div.post-content').first();
  if (mainContent.length === 0) mainContent = $('div.erx-wrap').first();
  return { links, content: extractContent(mainContent) };
}

export const djgou = definePlugin({
  name: 'djgou',
  priority: 2, // 优先级2：质量良好的数据源
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 1. 构建搜索URL并请求（带重试）
    const searchURL = `${SITE_URL}/search.php?q=${encodeURIComponent(keyword)}&page=1`;
    let body: string;
    try {
      body = await doRequestWithRetry(searchURL, DEFAULT_TIMEOUT);
    } catch (err) {
      throw new Error(`[djgou] 搜索请求失败: ${err instanceof Error ? err.message : err}`);
    }

    // 2. 解析搜索结果页面；部分节点先返回 BTWAF JS 跳转页，需跟进一次
    let $ = cheerio.load(body);
    if ($('article.post-item-row').length === 0) {
      const match = body.match(BTWAF_URL_REGEX);
      if (match) {
        let challengeURL = match[1];
        if (challengeURL.startsWith('/')) challengeURL = SITE_URL + challengeURL;
        try {
          const challengeBody = await doRequestWithRetry(challengeURL, DEFAULT_TIMEOUT);
          $ = cheerio.load(challengeBody);
        } catch {
          /* challenge 跟进失败时保留原解析结果 */
        }
      }
    }

    // 3. 解析每个搜索结果项
    const results: SearchResult[] = [];
    $('article.post-item-row').each((_i, el) => {
      const s = $(el);
      const linkElem = s.find('h2.post-title a').first();
      if (linkElem.length === 0) return;

      const title = linkElem.text().trim();
      let link = linkElem.attr('href') ?? '';
      if (link === '' || title === '') return;

      // 处理相对路径
      if (!link.startsWith('http')) {
        link = link.startsWith('/') ? SITE_URL + link : `${SITE_URL}/${link}`;
      }

      const timeText = s.find('.post-date').first().text().trim();

      // 唯一ID：链接路径部分（查询转义）
      const itemID = link.startsWith(SITE_URL) ? link.slice(SITE_URL.length) : link;
      const uniqueID = `djgou-${encodeURIComponent(itemID.replace(/^\/+|\/+$/g, ''))}`;

      results.push({
        message_id: uniqueID,
        unique_id: uniqueID,
        channel: '', // 插件搜索结果必须为空字符串
        datetime: parseTime(timeText),
        title,
        content: link, // 暂存详情页链接，获取详情后覆盖
        links: [],
        tags: ['短剧'],
      });
    });

    // 4. 并发抓详情页（信号量 15），只保留有链接的结果
    const limit = createLimiter(MAX_CONCURRENCY);
    const enhanced = await Promise.all(
      results.map(async (result) => {
        const detail = await limit(() => fetchDetailPage(result.content));
        if (!detail || detail.links.length === 0) return null;
        return { ...result, links: detail.links, content: detail.content };
      }),
    );
    const enhancedResults = enhanced.filter((r): r is SearchResult => r !== null);

    // 5. 关键词过滤
    return filterResultsByKeyword(enhancedResults, keyword);
  },
});
