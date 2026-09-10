// 磁力猫（clmao / clm64.top）插件 —— Go plugin/clmao 的复刻
//
// 现代模板：关键词 base64 编码后 GET /search?word=<b64>&sort=time（单页，
// 避免详情并发触发限流）；列表页可能内嵌 atob("<base64>") 载荷，需先解码。
// 列表 a.SearchListTitle_result_title → 详情页取 magnet。
// 兼容旧模板（zsky 风格 .tbox .ssbox）解析。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'clmao';
const BASE_URL = 'https://clm64.top';
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 10; // 详情页并发上限（Go semaphore）
const MAX_PAGES = 1; // 现代 clm64 页面单页已返回足够结果

// 磁力链接正则
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/;
// 现代 atob 载荷：(?s)atob\(["']([A-Za-z0-9+/=]+)["']\)
const MODERN_PAYLOAD_REGEX = /atob\(["']([A-Za-z0-9+/=]+)["']\)/s;
const MODERN_MAGNET_REGEX = /magnet:\?[^\s"'<>]+/i;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  // 暂时不使用压缩编码，避免解压问题
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 带重试的请求（3 次，失败后 sleep (i+1)s；网络错误才重试，非 200 原样返回） */
async function doRequestWithRetry(url: string): Promise<{ status: number; body: string }> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal });
      // Go 语义：请求成功即返回（状态码由调用方检查）
      return { status: resp.status, body: await resp.text() };
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    if (i < MAX_RETRIES - 1) await sleep((i + 1) * 1000);
  }
  throw new Error(`[${PLUGIN_NAME}] 请求失败，已重试${MAX_RETRIES}次: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 解码页面内嵌的 atob("<base64>") 载荷（base64 + PathUnescape） */
function decodeModernPayload(raw: string): string {
  const m = raw.match(MODERN_PAYLOAD_REGEX);
  if (!m) return raw;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

/** 清理标题：去【】与 [] 内内容、折叠空白 */
function cleanTitle(title: string): string {
  return title
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL 末段路径作为资源 ID */
function pathToken(rawURL: string): string {
  let path: string;
  try {
    path = new URL(rawURL).pathname;
  } catch {
    return 'item';
  }
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length === 0) return 'item';
  return parts[parts.length - 1];
}

interface ModernDetail {
  title: string;
  content: string;
  links: Link[];
}

/** 抓取现代模板详情页，提取 magnet 与标题/内容 */
async function fetchModernDetail(detailURL: string): Promise<ModernDetail | null> {
  const { body } = await doRequestWithRetry(detailURL);
  const decoded = decodeModernPayload(body);
  const $ = cheerio.load(decoded);
  let magnet = $("a[href^='magnet:']").attr('href') ?? '';
  if (magnet === '') magnet = decoded.match(MODERN_MAGNET_REGEX)?.[0] ?? '';
  if (magnet === '') return null;
  const title = cleanTitle($('h1.Information_title').first().text().trim());
  const content = $('.Information_l_content').first().text().trim();
  return { title, content, links: [{ type: 'magnet', url: magnet, password: '', work_title: title }] };
}

/** 现代模板：列表项 + 并发详情页（信号量 10） */
async function parseModernSearchResults(html: string): Promise<SearchResult[]> {
  const $ = cheerio.load(html);
  interface Candidate {
    result: SearchResult;
    detail: string;
  }
  const candidates: Candidate[] = [];
  $('#Search_list_wrapper li').each((_i, item) => {
    const anchor = $(item).find('a.SearchListTitle_result_title[href]').first();
    if (anchor.length === 0) return;
    const hrefRaw = anchor.attr('href') ?? '';
    const title = cleanTitle(anchor.text());
    if (title === '' || hrefRaw === '') return;
    let href = hrefRaw;
    if (!href.startsWith('http://') && !href.startsWith('https://')) href = `${BASE_URL}/${href.replace(/^\//, '')}`;
    const content = $(item).find('.Search_list_info').text().trim();
    const id = pathToken(href);
    candidates.push({
      result: {
        message_id: `${PLUGIN_NAME}-${id}`,
        unique_id: `${PLUGIN_NAME}-${id}`,
        channel: '',
        datetime: new Date().toISOString(),
        title,
        content,
        links: [],
      },
      detail: href,
    });
  });
  if (candidates.length === 0) return [];

  const limit = createLimiter(MAX_CONCURRENCY);
  const fetched = await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        const result: SearchResult = { ...c.result, links: [] };
        try {
          const detail = await fetchModernDetail(c.detail);
          if (detail) {
            if (detail.title !== '') result.title = detail.title;
            if (detail.content !== '') result.content = detail.content;
            result.links = detail.links;
          }
        } catch {
          /* 详情失败保留列表信息 */
        }
        return result.links.length > 0 ? result : null;
      }),
    ),
  );
  return fetched.filter((r): r is SearchResult => r !== null);
}

/** 旧模板：映射分类（[影视] 等） */
function mapCategory(category: string): string {
  const table: Record<string, string> = {
    '[影视]': 'video',
    '[音乐]': 'music',
    '[图像]': 'image',
    '[文档书籍]': 'document',
    '[压缩文件]': 'archive',
    '[安装包]': 'software',
    '[其他]': 'others',
  };
  return table[category] ?? 'others';
}

/** 旧模板：解析单个 .tbox .ssbox 结果 */
function parseOldResult($: cheerio.CheerioAPI, s: cheerio.Cheerio<cheerio.AnyNode>): SearchResult | null {
  const result: SearchResult = {
    message_id: '',
    unique_id: '', // Go 用 time.Now().UnixNano() 兜底唯一 ID
    channel: '',
    datetime: new Date().toISOString(),
    title: '',
    content: '',
    links: [],
  };

  // 标题与分类
  const titleSection = s.find('.title h3');
  result.title = cleanTitle(titleSection.find('a').text().trim());
  const category = titleSection.find('span').text().trim();
  if (category !== '') result.tags = [mapCategory(category)];

  // 磁力链接 + 元数据（添加时间/大小/热度 追加到内容）
  const sbar = s.find('.sbar');
  const magnetLink = sbar.find("a[href^='magnet:']").attr('href');
  if (magnetLink) result.links = [{ type: 'magnet', url: magnetLink, password: '' }];

  const metadata: string[] = [];
  sbar.find('span').each((_i, span) => {
    const text = $(span).text().trim();
    if (text.includes('添加时间:') || text.includes('大小:') || text.includes('热度:')) metadata.push(text);
  });
  if (metadata.length > 0) {
    result.content = result.content !== '' ? `${result.content}\n\n` : '';
    result.content += metadata.join(' | ');
  }

  // 文件列表
  const files: string[] = [];
  s.find('.slist ul li').each((_i, li) => {
    const text = $(li).text().trim();
    if (text !== '') files.push(text);
  });
  if (files.length > 0) {
    result.content = result.content !== '' ? `${result.content}\n\n文件列表:\n` : '文件列表:\n';
    result.content += files.join('\n');
  }

  if (result.title === '' || result.links.length === 0) return null;
  result.unique_id = `${PLUGIN_NAME}-${process.hrtime.bigint().toString()}`;
  return result;
}

/** 旧模板：提取搜索结果 */
function extractOldResults($: cheerio.CheerioAPI): SearchResult[] {
  const results: SearchResult[] = [];
  $('.tbox .ssbox').each((_i, s) => {
    const parsed = parseOldResult($, s);
    if (parsed) results.push(parsed);
  });
  return results;
}

/** 搜索指定页面（关键词 base64 编码，分页通过可选的 p 参数追加） */
async function searchPage(keyword: string, page: number): Promise<SearchResult[]> {
  const encodedKeyword = Buffer.from(keyword, 'utf8').toString('base64');
  let searchURL = `${BASE_URL}/search?word=${encodeURIComponent(encodedKeyword)}&sort=time`;
  if (page > 1) searchURL += `&p=${page}`;

  const { status, body } = await doRequestWithRetry(searchURL);
  if (status !== 200) throw new Error(`[${PLUGIN_NAME}] 请求返回状态码: ${status}`);

  const decodedHTML = decodeModernPayload(body);
  if (decodedHTML !== body) {
    const modernResults = await parseModernSearchResults(decodedHTML);
    if (modernResults.length > 0) return modernResults;
  }

  // 兼容旧模板
  return extractOldResults(cheerio.load(decodedHTML));
}

export const clmao = definePlugin({
  name: PLUGIN_NAME,
  priority: 3,
  skipServiceFilter: true, // 磁力搜索插件，跳过 Service 层过滤
  async search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 1. 搜索第一页（MaxPages=1，现代页面单页已足够，避免详情并发触发限流）
    const allResults = await searchPage(keyword, 1);

    // 2. 关键词过滤（ext.search 可覆盖过滤关键词）
    let searchKeyword = keyword;
    const searchParam = ext['search'];
    if (typeof searchParam === 'string' && searchParam !== '') searchKeyword = searchParam;
    return filterResultsByKeyword(allResults, searchKeyword);
  },
});
