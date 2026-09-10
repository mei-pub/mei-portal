// 6v 电影（66ss.org）磁力插件 —— Go plugin/xb6v 的复刻
// 契约：POST /e/search/11index.php（帝国 CMS 表单，不跟随重定向拿 Location）
// → 结果页 ul#post_container li.post 提详情链接 → 详情页 td 含「磁力：」内取
// a[href^='magnet:']，每个磁力链接一条结果。
// 注：Go 版 BackupURL（www.xb6v.com）声明后未使用，保留常量但不参与切换；
// gzip 由 Node fetch 自动解压，不手动设 Accept-Encoding。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://www.66ss.org'; // 主域名
const BACKUP_URL = 'https://www.xb6v.com'; // 备用域名（Go 版声明未用）
const SEARCH_PATH = '/e/search/11index.php'; // 搜索端点（当前站点表单入口）
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_CONCURRENCY = 50; // 详情页最大并发数
const MAX_RESULTS = 50; // 最大搜索结果数
const DETAIL_CACHE_TTL = 30 * 60 * 1000;
const REQUEST_TIMEOUT = 30_000;

/** cheerio 选中集类型（避免直接依赖 domhandler 类型导出） */
type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

function buildHeaders(referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (referer !== '') headers['Referer'] = referer;
  return headers;
}

async function httpGet(url: string, referer: string): Promise<{ status: number; body: string; location: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { headers: buildHeaders(referer), signal: controller.signal, redirect: 'follow' });
    return { status: resp.status, body: await resp.text(), location: resp.headers.get('location') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

async function httpPostNoRedirect(url: string, postData: string, referer: string): Promise<{ status: number; body: string; location: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...buildHeaders(referer), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      signal: controller.signal,
      redirect: 'manual', // Go：CheckRedirect 返回 ErrUseLastResponse，取 Location 头
    });
    return { status: resp.status, body: await resp.text(), location: resp.headers.get('location') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

interface DetailPageInfo {
  url: string;
  /** 发布日期（ISO 字符串；取不到时为当前时间） */
  dateTime: string;
}

/** 检查是否是有效的内容页面 URL：/分类/子分类/数字.html（Go isValidContentURL） */
function isValidContentURL(href: string): boolean {
  const parts = href.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2) return false;
  const lastPart = parts[parts.length - 1];
  if (!lastPart.endsWith('.html')) return false;
  const nameWithoutExt = lastPart.slice(0, -'.html'.length);
  if (nameWithoutExt === '') return false;
  return /\d+/.test(nameWithoutExt);
}

/** 从详情页 URL 提取资源 ID（Go extractResourceID） */
function extractResourceID(detailURL: string): string {
  const m = detailURL.match(/\/(\d+)\.html/);
  if (m) return m[1];
  return String(Date.now()); // Go：UnixNano 兜底
}

/** 清理标题，移除网站名称等（Go cleanTitle） */
function cleanTitle(title: string): string {
  const cleaners = ['6v电影-新版', '6v电影', '新版6v', '新版6V', '6V电影'];

  let cleaned = title;
  for (const cleaner of cleaners) {
    // 移除前缀（包括可能的空格，含全角空格）
    if (cleaned.startsWith(cleaner)) {
      cleaned = cleaned.slice(cleaner.length).replace(/^[ \t　]+/, '');
    }
    // 移除后缀
    if (cleaned.endsWith(cleaner)) {
      cleaned = cleaned.slice(0, cleaned.length - cleaner.length).replace(/[ \t　]+$/, '');
    }
    // 移除中间的网站名称（用分隔符分隔）
    const parts = cleaned.split(cleaner);
    if (parts.length > 1) {
      const validParts = parts.map((part) => part.trim()).filter((part) => part !== '');
      if (validParts.length > 0) cleaned = validParts.join(' ');
    }
  }

  cleaned = cleaned.trim().replace(/\s+/g, ' ');
  if (cleaned === '') return '未知标题';
  return cleaned;
}

/** 从搜索结果页面提取详情页链接和日期（Go extractDetailURLs） */
function extractDetailURLs($: cheerio.CheerioAPI): DetailPageInfo[] {
  const detailPages: DetailPageInfo[] = [];
  const urlMap = new Set<string>(); // 去重

  // 只从搜索结果区域提取：ul#post_container li.post
  $('ul#post_container li.post').each((_i, li) => {
    const linkEl = $(li).find("a[href*='.html']");
    if (linkEl.length === 0) return;

    const href = linkEl.attr('href') ?? '';
    if (href === '') return;

    if (!isValidContentURL(href)) return;

    // 构建完整 URL
    let fullURL: string;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      fullURL = href;
    } else {
      fullURL = `${BASE_URL}/${href.replace(/^\//, '')}`;
    }
    if (urlMap.has(fullURL)) return;

    // 发布日期，格式通常是 "2025-08-17"
    const dateText = $(li).find('.info .info_date').text().trim();
    let dateTime = new Date().toISOString();
    if (dateText !== '') {
      const parsed = new Date(`${dateText}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) dateTime = parsed.toISOString();
    }

    urlMap.add(fullURL);
    detailPages.push({ url: fullURL, dateTime });
  });
  return detailPages;
}

interface MagnetLinkInfo {
  url: string;
  subTitle: string;
}

/** 从详情页提取磁力链接（含子标题）（Go extractMagnetLinks） */
function extractMagnetLinks($: cheerio.CheerioAPI): { links: Link[]; linkInfos: MagnetLinkInfo[] } {
  const links: Link[] = [];
  const linkInfos: MagnetLinkInfo[] = [];
  const linkMap = new Set<string>(); // 去重

  const collect = (scope: CheerioSelection, useFind: boolean) => {
    const magnets = useFind ? scope.find("a[href^='magnet:']") : scope;
    magnets.each((_i, a) => {
      const href = $(a).attr('href') ?? '';
      if (href === '') return;
      if (linkMap.has(href)) return;
      linkMap.add(href);

      let subTitle = $(a).text().trim();
      if (subTitle === '') subTitle = '磁力链接';

      links.push({ type: 'magnet', url: href, password: '' });
      linkInfos.push({ url: href, subTitle });
    });
  };

  // 查找包含「磁力：」的表格单元格
  $('td').each((_i, td) => {
    const text = $(td).text();
    if (text.includes('磁力：')) collect($(td), true);
  });

  // 表格中没有时，整个页面查找
  if (links.length === 0) collect($("a[href^='magnet:']"), false);

  return { links, linkInfos };
}

// 详情页缓存（模块级，读取时校验 TTL，等价于 Go 的后台定时删除）
const detailCache = new Map<string, { results: SearchResult[]; timestamp: number }>();

/** 获取单个详情页的磁力链接（Go fetchDetailPageMagnetLinks；失败返回空） */
async function fetchDetailPageMagnetLinks(detailURL: string, publishDateISO: string): Promise<SearchResult[]> {
  const cached = detailCache.get(detailURL);
  if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) return cached.results;

  let resp: { status: number; body: string; location: string };
  try {
    resp = await httpGet(detailURL, BASE_URL);
  } catch {
    return [];
  }
  if (resp.status !== 200) return [];

  const $ = cheerio.load(resp.body);

  // 标题
  let title = $('h1').text().trim();
  if (title === '') title = '未知标题';
  title = cleanTitle(title);

  // 分类
  const category = $('.info_category a').text().trim();

  // 磁力链接
  const { links, linkInfos } = extractMagnetLinks($);
  if (links.length === 0) return [];

  // 每个磁力链接一条结果
  const resourceBase = extractResourceID(detailURL);
  const results: SearchResult[] = linkInfos.map((linkInfo, i) => {
    const resourceID = `${resourceBase}-${i}`;
    return {
      title: `${title}-${linkInfo.subTitle}`, // 主标题-子标题
      content: `分类：${category}\n磁力链接：${linkInfo.subTitle}`,
      channel: '', // 插件搜索结果必须为空字符串
      message_id: `xb6v-${resourceID}`,
      unique_id: `xb6v-${resourceID}`,
      datetime: publishDateISO, // 搜索结果页提取的真实发布日期
      links: [links[i]], // 每个结果只包含一个链接
      tags: [category],
    };
  });

  detailCache.set(detailURL, { results, timestamp: Date.now() });
  return results;
}

export const xb6v = definePlugin({
  name: 'xb6v',
  priority: 3, // Go NewBaseAsyncPluginWithFilter("xb6v", 3, true)
  skipServiceFilter: true, // 磁力源：跳过 Service 层过滤，插件内部按关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 先 URL 解码（处理 %20 等编码）
    let kw = keyword;
    try {
      kw = decodeURIComponent(keyword);
    } catch {
      /* 解码失败使用原始关键词 */
    }

    // 关键词优化：包含空格时只取空格前的部分
    const spaceIndex = kw.indexOf(' ');
    if (spaceIndex > 0) kw = kw.slice(0, spaceIndex);

    // 第一步：POST 搜索（不跟随重定向）
    const searchURL = BASE_URL + SEARCH_PATH;
    const postData = `show=title&tempid=1&tbname=article&mid=1&dopost=search&submit=&keyboard=${encodeURIComponent(kw)}`;

    const post = await httpPostNoRedirect(searchURL, postData, BASE_URL);
    let location = post.location;

    // 无 Location 头时从响应体中解析（JS 重定向 / searchid URL / result/?searchid=）
    if (location === '') {
      const bodyStr = post.body;
      if (bodyStr.includes('location.href') || bodyStr.includes('window.location')) {
        const m = bodyStr.match(/location\.href\s*=\s*["']([^"']+)["']/);
        if (m) location = m[1];
      }
      if (location === '') {
        // 查找可能的 URL 模式，比如包含 searchid 的链接
        const re = /(?:href|url)\s*[=:]\s*["']?([^"'\s]*searchid=[^"'\s&]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(bodyStr)) !== null) {
          location = m[1];
          break;
        }
      }
      if (location === '') {
        const m = bodyStr.match(/result\/\?searchid=\d+/);
        if (m) location = m[0];
      }
      if (location === '') throw new Error('[xb6v] 未找到搜索结果页面重定向信息');
    }

    // 构建完整搜索结果 URL：Location 通常是 "result/?searchid=39616" 形式
    let resultURL: string;
    if (location.startsWith('result/')) {
      resultURL = `${BASE_URL}/e/search/${location}`;
    } else {
      resultURL = `${BASE_URL}/${location.replace(/^\//, '')}`;
    }

    // 第二步：获取搜索结果页面
    const page = await httpGet(resultURL, BASE_URL);
    if (page.status !== 200) throw new Error(`[xb6v] 搜索结果响应状态码异常: ${page.status}`);

    const $ = cheerio.load(page.body);
    let detailPages = extractDetailURLs($);
    if (detailPages.length === 0) throw new Error('[xb6v] 未找到搜索结果');

    // 限制结果数量
    if (detailPages.length > MAX_RESULTS) detailPages = detailPages.slice(0, MAX_RESULTS);

    // 第三步：并发获取详情页磁力链接（Go：semaphore 50 + idx*100ms 错峰）
    const limit = createLimiter(MAX_CONCURRENCY);
    const settled = await Promise.allSettled(
      detailPages.map((pageInfo, idx) =>
        limit(async () => {
          await new Promise((r) => setTimeout(r, idx * 100));
          return fetchDetailPageMagnetLinks(pageInfo.url, pageInfo.dateTime);
        }),
      ),
    );
    const results = settled
      .filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === 'fulfilled')
      .flatMap((s) => s.value)
      .filter((r) => r.links.length > 0); // 过滤无磁力链接结果

    // 插件层关键词过滤（跳过了 Service 层过滤，必须执行）
    return filterResultsByKeyword(results, kw);
  },
});
