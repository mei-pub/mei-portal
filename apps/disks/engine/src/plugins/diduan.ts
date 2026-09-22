// 低端影视（DIDUAN）插件 —— Go plugin/diduan 的代码级移植
// ddys.io：搜索页（影视 h2 区的 movie-card / 旧模板 article）→ 详情页解出网盘链接
//（atob 懒加载地址 + 标签式 <a> 链接两种途径）。
// 说明：Go 版以 cloudscraper（stealth 关闭）发起请求；TS 版无对应依赖且禁新增 npm 包，
//       以等价 UA 的普通 fetch 实现（未观察到 Cloudflare 挑战时行为一致）。
//       Go 版的 scraperMu 互斥是 cloudscraper 内部状态所需，fetch 无共享状态，不移植。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://ddys.io';
const SEARCH_PATH = '/search?q=';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 50;
const MAX_CONCURRENCY = 20;
const PAGE_TIMEOUT = 15_000; // Go 版由 cloudscraper 内部超时控制，此处取等量级

// 详情页通过 JavaScript atob() 懒加载网盘地址（Go encodedURLRegex 原样搬运）
const ENCODED_URL_REGEX = /atob\(\s*['"]([A-Za-z0-9+/=_-]+)['"]\s*\)/gi;

function absoluteURL(raw: string): string {
  raw = raw.trim();
  if (raw === '') return '';
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return BASE_URL + raw;
  return raw;
}

/** 从 URL 查询参数提取密码（Go linkPassword） */
function linkPassword(rawURL: string): string {
  try {
    const parsed = new URL(rawURL);
    for (const key of ['pwd', 'password', 'pass', 'code']) {
      const value = (parsed.searchParams.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* 非法 URL 无密码 */
  }
  return '';
}

/** 根据URL自动识别网盘类型（Go determineCloudType，原样 Contains 语义） */
function determineCloudType(url: string): string {
  if (url.includes('pan.quark.cn')) return 'quark';
  if (url.includes('drive.uc.cn')) return 'uc';
  if (url.includes('pan.baidu.com')) return 'baidu';
  if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
  if (url.includes('pan.xunlei.com')) return 'xunlei';
  if (url.includes('cloud.189.cn')) return 'tianyi';
  if (url.includes('caiyun.139.com')) return 'mobile';
  if (url.includes('115.com')) return '115';
  if (url.includes('123pan.com')) return '123';
  if (url.includes('mypikpak.com')) return 'pikpak';
  if (url.includes('lanzou')) return 'lanzou';
  return 'others';
}

interface PageResult {
  status: number;
  cfMitigated: boolean;
  body: string;
}

/** 抓取页面（Go getPage；非 200 抛错，Cloudflare Managed Challenge 单独识别） */
async function getPage(rawURL: string): Promise<PageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT);
  try {
    const resp = await fetch(rawURL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    return {
      status: resp.status,
      cfMitigated: (resp.headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge',
      body: await resp.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function httpStatusError(action: string, page: PageResult): Error {
  if (page.cfMitigated) {
    return new Error(`[diduan] ${action}触发 Cloudflare Managed Challenge (HTTP ${page.status})`);
  }
  return new Error(`[diduan] ${action}HTTP状态错误: ${page.status}`);
}

/** 解析单个搜索结果项（Go parseResultItem：新版 movie-card / 旧版 WordPress 模板双路径） */
function parseResultItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<any>, index: number): SearchResult | null {
  // 新版 ddys 卡片：/movie/<slug>，标题位于 h3 a，海报位于 img
  let linkEl = s.find("h3 a[href^='/movie/']").first();
  if (linkEl.length === 0) linkEl = s.find("a[href^='/movie/']").first();
  if (linkEl.length > 0) {
    const detailURL = absoluteURL(linkEl.attr('href') ?? '');
    if (detailURL === '') return null;
    const title = linkEl.text().trim();
    if (title === '') return null;
    let slug = detailURL.startsWith(`${BASE_URL}/movie/`)
      ? detailURL.slice(`${BASE_URL}/movie/`.length)
      : detailURL;
    slug = slug.replace(/^\/+/, '').replace(/\/+$/, ''); // Go strings.Trim(…, "/")
    if (slug === '') slug = `item-${index}`;
    const content = s.find('h3').parent().text().trim();
    const result: SearchResult = {
      title,
      content: `${content}\n详情页: ${detailURL}`,
      channel: '',
      message_id: `diduan-${slug}`,
      unique_id: `diduan-${slug}`,
      datetime: new Date().toISOString(),
      links: [],
    };
    const poster = s.find('img').first().attr('src');
    if (poster && poster !== '') result.images = [poster];
    return result;
  }

  // 旧 WordPress 模板兼容路径：文章ID
  const articleClass = s.attr('class') ?? '';
  let postID = articleClass.match(/post-(\d+)/)?.[1] ?? '';
  if (postID === '') postID = `unknown-${index}`;

  const oldLinkEl = s.find('.post-title a');
  if (oldLinkEl.length === 0) return null; // 跳过无标题链接的结果

  const title = oldLinkEl.text().trim();
  if (title === '') return null;

  const detailURL = oldLinkEl.attr('href') ?? '';
  if (detailURL === '') return null; // 跳过无链接的结果

  // 发布时间（ISO 8601，解析失败用当前时间）
  const datetimeAttr = s.find('.meta_date time.entry-date').attr('datetime');
  const parsed = datetimeAttr ? new Date(datetimeAttr) : null;
  const publishTime = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();

  // 分类
  const categoryEl = s.find('.meta_categories .cat-links a');
  const category = categoryEl.length > 0 ? categoryEl.text().trim() : '未分类';

  // 简介（限制长度）
  const contentEl = s.find('.entry-content');
  let content = '';
  if (contentEl.length > 0) {
    content = contentEl.text().trim();
    if (content.length > 200) content = content.slice(0, 200) + '...';
  }

  const uid = `diduan-${postID}-${index}`;
  return {
    title,
    content: `分类：${category}\n${content}\n详情页: ${detailURL}`,
    channel: '', // 插件结果 Channel 必须为空
    message_id: uid,
    unique_id: uid,
    datetime: publishTime,
    links: [], // 先为空，详情页处理后添加
    tags: [category],
  };
}

/** 解析搜索结果HTML（Go parseSearchResults：影视区 movie-card，回退旧模板 article） */
function parseSearchResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  // 第一个「影视」h2 的祖父容器内的 movie-card 才是搜索结果，后面的是推荐内容
  let cards: cheerio.Cheerio<any> | null = null;
  for (const heading of $('h2').toArray()) {
    if ($(heading).text().trim().startsWith('影视')) {
      cards = $(heading).parent().parent().find('.movie-card');
      break;
    }
  }
  if (cards === null || cards.length === 0) {
    // 兼容旧模板：仅扫描文章列表
    cards = $("article[class*='post-']");
  }
  cards.each((i, el) => {
    if (results.length >= MAX_RESULTS) return false; // EachWithBreak 语义
    const result = parseResultItem($, $(el), i + 1);
    if (result) results.push(result);
    return true;
  });

  return results;
}

/** 在网盘链接附近搜索提取码（Go extractPassword：链接前后 200 字符窗口） */
function extractPassword(content: string, panURL: string): string {
  const patterns = [
    /提取[码密][：:]?\s*([A-Za-z0-9]{4,8})/,
    /密码[：:]?\s*([A-Za-z0-9]{4,8})/,
    /[码密][：:]?\s*([A-Za-z0-9]{4,8})/,
    /([A-Za-z0-9]{4,8})\s*[是为]?提取[码密]/,
  ];
  const urlIndex = content.indexOf(panURL);
  if (urlIndex === -1) return '';

  const start = Math.max(urlIndex - 200, 0);
  const end = Math.min(urlIndex + panURL.length + 200, content.length);
  const searchArea = content.slice(start, end);

  for (const re of patterns) {
    const m = searchArea.match(re);
    if (m) return m[1];
  }
  return '';
}

/** 解析详情页网盘链接（Go parseNetworkDiskLinks：atob 懒加载 + 标签式 a 链接） */
function parseNetworkDiskLinks(htmlContent: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  const appendLink = (rawURL: string, password: string): void => {
    const url = absoluteURL(rawURL);
    if (url === '' || seen.has(url)) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;
    seen.add(url);
    links.push({
      type: determineCloudType(url),
      url,
      password: password !== '' ? password : linkPassword(url),
    });
  };

  // 途径一：atob() 懒加载的真实地址（Go：StdEncoding 严格校验，替换 - 为 + 后必须仍是合法标准 base64）
  for (const m of htmlContent.matchAll(ENCODED_URL_REGEX)) {
    const normalized = m[1].replaceAll('-', '+');
    // StdEncoding 约束：长度为 4 的倍数、标准字母表、'=' 只能是末尾的 1~2 位填充
    if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) continue;
    const padding = normalized.length - normalized.replace(/=+$/, '').length;
    if (padding > 2) continue;
    if (padding > 0 && /=[^=]/.test(normalized.slice(normalized.indexOf('=')))) continue;
    const decodedURL = Buffer.from(normalized, 'base64').toString('utf-8').trim();
    if (decodedURL.includes('://')) appendLink(decodedURL, '');
  }

  // 途径二：标签式网盘链接（(夸克网盘)： <a href="...">xxx</a> 等 + 通用 pan/drive/cloud 模式）
  const patterns: Array<{ re: RegExp; urlType: string }> = [
    { re: /\(夸克[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, urlType: 'quark' },
    { re: /\(百度[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, urlType: 'baidu' },
    { re: /\(阿里[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, urlType: 'aliyun' },
    { re: /\(天翼[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, urlType: 'tianyi' },
    { re: /\(迅雷[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, urlType: 'xunlei' },
    // 通用模式
    { re: /<a[^>]*href\s*=\s*["'](https?:\/\/[^"']*(?:pan|drive|cloud)[^"']*)["'][^>]*>([^<]+)<\/a>/g, urlType: 'others' },
  ];

  for (const pattern of patterns) {
    for (const m of htmlContent.matchAll(pattern.re)) {
      const url = m[1];
      let urlType = determineCloudType(url);
      if (urlType === 'others') urlType = pattern.urlType;
      const password = extractPassword(htmlContent, url) || linkPassword(url);
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ type: urlType, url, password });
      }
    }
  }

  return links;
}

// 详情页链接缓存（Go detailCache：模块级、无 TTL）
const detailCache = new Map<string, Link[]>();

/** 获取详情页的网盘链接（Go fetchDetailPageLinks；失败静默返回空） */
async function fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
  const cached = detailCache.get(detailURL);
  if (cached !== undefined) return cached;

  let page: PageResult;
  try {
    page = await getPage(detailURL);
  } catch {
    return [];
  }
  if (page.status !== 200) return [];

  const links = parseNetworkDiskLinks(page.body);
  if (links.length > 0) detailCache.set(detailURL, links);
  return links;
}

/** 从 Content 中提取详情页URL（Go extractDetailURLFromContent） */
function extractDetailURLFromContent(content: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('详情页: ')) return line.slice('详情页: '.length);
  }
  return '';
}

/** 清理 Content，移除详情页URL行（Go cleanContent） */
function cleanContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('详情页: '))
    .join('\n');
}

/** 并发获取详情页链接（Go fetchDetailLinks；仅保留成功解出链接的结果） */
async function fetchDetailLinks(searchResults: SearchResult[]): Promise<SearchResult[]> {
  const limit = createLimiter(MAX_CONCURRENCY);
  return (
    await Promise.all(
      searchResults.map(async (r) => {
        const detailURL = extractDetailURLFromContent(r.content);
        if (detailURL === '') return null;
        const links = await fetchDetailPageLinks(detailURL);
        if (links.length === 0) return null;
        return { ...r, links, content: cleanContent(r.content) };
      }),
    )
  ).filter((r): r is SearchResult => r !== null);
}

export const diduan = definePlugin({
  name: 'diduan',
  priority: 1, // 标准网盘插件，启用 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 第一步：执行搜索获取结果列表
    const searchURL = `${BASE_URL}${SEARCH_PATH}${encodeURIComponent(keyword)}`;
    const page = await getPage(searchURL);
    if (page.status !== 200) throw httpStatusError('搜索', page);
    const searchResults = parseSearchResults(page.body);

    // 第二步：并发获取详情页链接
    const finalResults = await fetchDetailLinks(searchResults);

    // 第三步：关键词过滤（标准网盘插件需要过滤）
    return filterResultsByKeyword(finalResults, keyword);
  },
});
