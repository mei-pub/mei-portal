// 电影云集（DYYJ）网盘搜索插件 —— Go plugin/dyyj 的复刻
// 站点 bbs.dyyjmax.org（Flarum 论坛）。契约：GET /api/discussions（JSON:API，
// include=mostRelevantPost）从 contentHtml 提取网盘链接；API 未给出内联链接时回退
// 到详情页 HTML（noscript#flarum-content，Cloudflare 盾后）解析。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://bbs.dyyjmax.org';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 100; // Go MaxResults（API page[limit]）
const MAX_CONCURRENCY = 100; // Go MaxConcurrency
const REQUEST_TIMEOUT_MS = 30_000; // Go RequestTimeout

// 预编译正则（原样搬运）
const HTML_TAG_REGEX = /<[^>]+>/;

// 发布时间 meta 标签正则（Go publishTimeRegexes）
const PUBLISH_TIME_REGEXES = [
  /<meta\s+name=["']article:published_time["']\s+content=["']([^"']+)["']/,
  /<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/,
  /<meta\s+name=["']article:updated_time["']\s+content=["']([^"']+)["']/,
  /<time[^>]*datetime=["']([^"']+)["']/,
];

// 网盘链接匹配模式（Go networkDiskPatterns，正则原样搬运）
const NETWORK_DISK_PATTERNS: Array<{ name: string; regex: RegExp; urlType: string }> = [
  { name: '夸克网盘', regex: /<p><strong>夸克[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'quark' },
  { name: '百度网盘', regex: /<p><strong>百度[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'baidu' },
  { name: '阿里云盘', regex: /<p><strong>阿里[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'aliyun' },
  { name: '天翼云盘', regex: /<p><strong>天翼[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'tianyi' },
  { name: '迅雷网盘', regex: /<p><strong>迅雷[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'xunlei' },
  { name: '通用网盘', regex: /<a[^>]*href\s*=\s*["'](https?:\/\/[^"']*(?:pan|drive|cloud)[^"']*)["'][^>]*>/g, urlType: 'others' },
];

// 网盘名称（Go isNetworkDiskName）
const NETWORK_DISK_NAMES = [
  '夸克', '百度', '阿里', '天翼', '迅雷', '115', '123', '蓝奏',
  '夸克网盘', '百度网盘', '阿里云盘', '天翼云盘', '迅雷网盘', '115网盘', '123网盘',
];

/**
 * 带重试的抓取（Go doRequestWithRetry）：3 次尝试，非 200 也重试，
 * 退避 200ms * 2^(i-1)；整个重试过程共享同一超时（Go 的 ctx 跨克隆请求生效）。
 */
async function fetchWithRetry(url: string, referer: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: accept,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Connection: 'keep-alive',
            Referer: referer,
          },
          signal: controller.signal,
        });
        if (resp.status === 200) return await resp.text();
        lastErr = new Error(`HTTP 状态码 ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`[dyyj] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 根据URL自动识别网盘类型（Go determineCloudType） */
function determineCloudType(url: string): string {
  if (url.includes('pan.quark.cn')) return 'quark';
  if (url.includes('drive.uc.cn')) return 'uc';
  if (url.includes('pan.baidu.com')) return 'baidu';
  if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
  if (url.includes('pan.xunlei.com')) return 'xunlei';
  if (url.includes('cloud.189.cn')) return 'tianyi';
  if (url.includes('caiyun.139.com')) return 'mobile';
  if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115';
  if (
    url.includes('123684.com') || url.includes('123685.com') ||
    url.includes('123912.com') || url.includes('123pan.com') ||
    url.includes('123pan.cn') || url.includes('123592.com')
  ) return '123';
  if (url.includes('mypikpak.com')) return 'pikpak';
  if (url.includes('magnet:')) return 'magnet';
  if (url.includes('ed2k://')) return 'ed2k';
  return 'others';
}

/** 检查是否是网盘名称（Go isNetworkDiskName） */
function isNetworkDiskName(text: string): boolean {
  const lowerText = text.toLowerCase();
  return NETWORK_DISK_NAMES.some((name) => lowerText.includes(name.toLowerCase()));
}

/** 从URL参数中提取密码（Go extractPasswordFromURL） */
function extractPasswordFromURL(linkURL: string): string {
  const patterns = [/[?&]pwd=([A-Za-z0-9]{4,8})/, /[?&]password=([A-Za-z0-9]{4,8})/, /[?&]code=([A-Za-z0-9]{4,8})/];
  for (const pattern of patterns) {
    const m = linkURL.match(pattern);
    if (m) return m[1];
  }
  return '';
}

// Go extractPasswordFromURLText 的三个模式为 raw string 中的 "\\s"（字面反斜杠+s，
// RE2 中匹配 "\s" 字面量，实践中不命中）——按"正则原样搬运"原则保留等价语义。
const PASSWORD_TEXT_REGEXES = [
  /提取码[:：]?\\s*([A-Za-z0-9]{4,8})/,
  /密码[:：]?\\s*([A-Za-z0-9]{4,8})/,
  /pwd\\s*[=:：]\\s*([A-Za-z0-9]{4,8})/,
];

/** 从上下文文本提取密码（Go extractPasswordFromURLText） */
function extractPasswordFromURLText(text: string): string {
  for (const pattern of PASSWORD_TEXT_REGEXES) {
    const m = text.match(pattern);
    if (m) return m[1];
  }
  return '';
}

/** HTML → 纯文本（Go cleanContentHTML） */
function cleanContentHTML(contentHTML: string): string {
  try {
    return cheerio.load(contentHTML).text().trim();
  } catch {
    return contentHTML.replace(HTML_TAG_REGEX, '').trim();
  }
}

/** Flarum JSON:API 响应结构（Go dyyjAPIResponse 等） */
interface DyyjAPIResponse {
  data?: Array<{
    id: string;
    attributes?: { title?: string; createdAt?: string };
    relationships?: { mostRelevantPost?: { data?: { id?: string } } };
  }>;
  included?: Array<{ id: string; attributes?: { contentHtml?: string; createdAt?: string } }>;
}

/** 从 contentHtml 提取网盘链接（Go extractAPIContentLinks） */
function extractAPIContentLinks(contentHTML: string): Link[] {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(contentHTML);
  } catch {
    return [];
  }
  const links: Link[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_i, node) => {
    const href = ($(node).attr('href') ?? '').trim();
    if (href === '' || seen.has(href)) return;
    const linkType = determineCloudType(href);
    if (linkType === 'others') return;
    let password = extractPasswordFromURL(href);
    if (password === '') {
      let contextText = $(node).text();
      const parent = $(node).parent();
      if (parent.length > 0) contextText += ' ' + parent.text();
      password = extractPasswordFromURLText(contextText);
    }
    links.push({ type: linkType, url: href, password });
    seen.add(href);
  });
  return links;
}

/** API 搜索（Go executeSearchAPI） */
async function executeSearchAPI(keyword: string): Promise<SearchResult[]> {
  const params = new URLSearchParams();
  params.set('filter[q]', keyword);
  params.set('include', 'mostRelevantPost');
  params.set('page[limit]', String(MAX_RESULTS));
  const apiURL = `${BASE_URL}/api/discussions?${params.toString()}`;

  const body = await fetchWithRetry(apiURL, BASE_URL + '/', 'application/vnd.api+json, application/json');
  const payload = JSON.parse(body) as DyyjAPIResponse;

  const posts = new Map<string, string>(); // id → contentHtml
  for (const post of payload.included ?? []) {
    posts.set(post.id, post.attributes?.contentHtml ?? '');
  }

  const results: SearchResult[] = [];
  for (const discussion of payload.data ?? []) {
    const postID = discussion.relationships?.mostRelevantPost?.data?.id;
    if (!postID || !posts.has(postID)) continue;
    const contentHTML = posts.get(postID)!;
    const links = extractAPIContentLinks(contentHTML);
    if (links.length === 0) continue;

    const createdAtStr = discussion.attributes?.createdAt ?? '';
    const createdAt = new Date(createdAtStr);
    const datetime = createdAtStr !== '' && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : new Date().toISOString();

    results.push({
      message_id: '',
      unique_id: `dyyj-${discussion.id}`,
      channel: '', // 插件搜索结果必须为空
      datetime,
      title: (discussion.attributes?.title ?? '').trim(),
      content: cleanContentHTML(contentHTML),
      links,
    });
  }
  return results;
}

/** 是否有内联链接（Go hasInlineLinks） */
function hasInlineLinks(results: SearchResult[]): boolean {
  return results.some((r) => r.links.length > 0);
}

/** 根据标题过滤（多关键词 AND，Go filterByTitleKeyword） */
function filterByTitleKeyword(results: SearchResult[], keyword: string): SearchResult[] {
  if (keyword === '') return results;
  const keywords = keyword.toLowerCase().split(/\s+/).filter((k) => k !== '');
  return results.filter((r) => {
    const lowerTitle = r.title.toLowerCase();
    return keywords.every((kw) => lowerTitle.includes(kw));
  });
}

/** 从 Content 提取详情页 URL（Go extractDetailURLFromContent） */
function extractDetailURLFromContent(content: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('详情页: ')) return line.slice('详情页: '.length);
  }
  return '';
}

/** 清理 Content，移除详情页 URL 行（Go cleanContent） */
function cleanContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('详情页: '))
    .join('\n');
}

/** 从 HTML 提取发布时间（Go extractPublishTime），空串表示零值 */
function extractPublishTime(htmlContent: string): string {
  for (const re of PUBLISH_TIME_REGEXES) {
    const m = htmlContent.match(re);
    if (!m) continue;
    const timeStr = m[1].trim();
    // RFC3339 / +00:00 / Z / "2006-01-02 15:04:05" / "2006-01-02"
    if (/^\d{4}-\d{2}-\d{2}$/.test(timeStr)) return new Date(`${timeStr}T00:00:00Z`).toISOString();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeStr)) {
      return new Date(timeStr.replace(' ', 'T') + 'Z').toISOString();
    }
    const t = new Date(timeStr);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return '';
}

/** 正则备选解析网盘链接（Go parseNetworkDiskLinksWithRegex） */
function parseNetworkDiskLinksWithRegex(htmlContent: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const pattern of NETWORK_DISK_PATTERNS) {
    const matches = htmlContent.matchAll(pattern.regex);
    for (const match of matches) {
      const linkURL = match[1];
      if (seen.has(linkURL)) continue;
      seen.add(linkURL);
      let urlType = determineCloudType(linkURL);
      if (urlType === 'others') urlType = pattern.urlType;
      if (urlType !== 'others') {
        links.push({ type: urlType, url: linkURL, password: extractPasswordFromURL(linkURL) });
      }
    }
  }
  return links;
}

/** 解析网盘链接（Go parseNetworkDiskLinks）：goquery 强>strong 结构解析，正则备选 */
function parseNetworkDiskLinks(htmlContent: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(htmlContent);
  } catch {
    return parseNetworkDiskLinksWithRegex(htmlContent);
  }

  // noscript#flarum-content .container article .Post-body → p 内 strong 网盘名 + 链接
  $('noscript#flarum-content .container article .Post-body').each((_i, postBody) => {
    $(postBody)
      .find('p')
      .each((_j, pEl) => {
        const strongEl = $(pEl).find('strong');
        if (strongEl.length === 0) return;
        const strongText = strongEl.text().trim();
        if (!isNetworkDiskName(strongText)) return;

        // 先检查当前 p 标签，无链接则查找下一个 p 标签
        let linkEl = $(pEl).find('a');
        if (linkEl.length === 0) {
          const nextP = $(pEl).next();
          if (nextP.length > 0) linkEl = nextP.find('a');
        }
        if (linkEl.length === 0) return;

        const linkURL = linkEl.attr('href');
        if (!linkURL || linkURL === '') return;
        if (seen.has(linkURL)) return;
        seen.add(linkURL);

        const urlType = determineCloudType(linkURL);
        if (urlType !== 'others') {
          links.push({ type: urlType, url: linkURL, password: extractPasswordFromURL(linkURL) });
        }
      });
  });

  // goquery 没有找到链接时使用正则表达式作为备选
  if (links.length === 0) return parseNetworkDiskLinksWithRegex(htmlContent);
  return links;
}

/** 获取详情页的网盘链接和发布时间（Go fetchDetailPageLinks） */
async function fetchDetailPageLinks(detailURL: string): Promise<{ links: Link[]; publishTime: string }> {
  let body: string;
  try {
    body = await fetchWithRetry(
      detailURL,
      BASE_URL + '/',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    );
  } catch {
    return { links: [], publishTime: '' };
  }
  const links = parseNetworkDiskLinks(body);
  const publishTime = extractPublishTime(body);
  return { links, publishTime };
}

/** 并发获取详情页链接（Go fetchDetailLinks） */
async function fetchDetailLinks(searchResults: SearchResult[]): Promise<SearchResult[]> {
  if (searchResults.length === 0) return [];

  const limit = createLimiter(MAX_CONCURRENCY);
  const now = new Date().toISOString();
  const finalResults: SearchResult[] = [];

  await Promise.all(
    searchResults.map(async (r) => {
      const detailURL = extractDetailURLFromContent(r.content);
      if (detailURL === '') return;
      const { links, publishTime } = await fetchDetailPageLinks(detailURL);
      if (links.length === 0) return;
      r.links = links;
      // 未获取到发布时间时使用当前时间（Go fetchDetailLinks 逻辑）
      r.datetime = publishTime !== '' ? publishTime : now;
      r.content = cleanContent(r.content);
      finalResults.push(r);
    }),
  );

  return finalResults;
}

export const dyyj = definePlugin({
  name: 'dyyj',
  priority: 2, // 质量良好（Go NewBaseAsyncPlugin(PluginName, 2)，标准网盘插件需过滤）
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 第一步：Flarum API 搜索（响应自带内容与链接；HTML 详情页在 Cloudflare 盾后）
    const searchResults = await executeSearchAPI(keyword);
    if (hasInlineLinks(searchResults)) {
      return filterResultsByKeyword(searchResults, keyword);
    }

    // 第二步：先对标题进行关键词过滤，只处理包含关键词的结果（避免不必要的详情页请求）
    const titleFilteredResults = filterByTitleKeyword(searchResults, keyword);
    // 第三步：并发获取详情页链接（只对标题包含关键词的结果）
    const finalResults = await fetchDetailLinks(titleFilteredResults);
    // 第四步：最终关键词过滤（标题+内容，标准网盘插件需要过滤）
    return filterResultsByKeyword(finalResults, keyword);
  },
});
