// 盘搜（pansearch.me）插件 —— Go plugin/pansearch 的复刻
// 契约：先抓 /search 页面提取 Next.js buildId（30 分钟缓存 + 优雅降级），
// 再走 /_next/data/<buildId>/search.json 分页接口；404 表示 buildId 过期，
// 清缓存重取后再试一次首页。
// 注：Go 版另有每小时的 searchResultCache（只写不读）与每 10 分钟的
// buildId 后台刷新协程，前者为死代码、后者由懒加载 + TTL 覆盖，均不移植。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

const WEBSITE_URL = 'https://www.pansearch.me/search';
const BASE_URL_TEMPLATE = 'https://www.pansearch.me/_next/data/%s/search.json';

const DEFAULT_TIMEOUT = 15_000;
const PAGE_SIZE = 10;
const MAX_RESULTS = 50;
const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2; // buildId 请求重试（Go p.retries）
const MAX_API_PAGES = 5;
const BUILD_ID_CACHE_MS = 30 * 60 * 1000; // 30 分钟

const BUILD_ID_REGEX = /"buildId":"([^"]+)"/;
const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const PASSWORD_REGEX = /(?:提取码|访问码|密码|pwd|code)\s*[:=：]?\s*([0-9a-z]{4,8})/i;

const HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Referer: 'https://www.pansearch.me/',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

interface PanSearchItem {
  id: number;
  content: string;
  pan: string;
  image: string;
  time: string;
}

interface PanSearchResponse {
  pageProps: { data: { total: number; data: PanSearchItem[]; time: number }; limit: number; isMobile: boolean };
  __N_SSP?: boolean;
}

/** 抓取（带超时），返回状态码与响应体（Go 手写 http.Do + 状态码检查的对应物） */
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

// buildId 缓存（模块级；Go 用 RWMutex + 双检，事件循环下用 in-flight Promise 去重）
let buildIdCache = '';
let buildIdCacheTime = 0;
let buildIdInflight: Promise<string> | null = null;

function extractBuildId(body: string): string {
  const m = body.match(BUILD_ID_REGEX);
  if (m && m[1] !== '') return m[1];
  const script = body.match(NEXT_DATA_REGEX);
  if (script) {
    try {
      const nextData = JSON.parse(script[1]) as { buildId?: unknown };
      if (typeof nextData.buildId === 'string' && nextData.buildId !== '') return nextData.buildId;
    } catch {
      /* JSON 解析失败继续降级 */
    }
  }
  return '';
}

/** 获取 buildId：30 分钟缓存；任何失败若有旧缓存则优雅降级返回旧值（Go getBuildId） */
async function getBuildId(): Promise<string> {
  if (buildIdCache !== '' && Date.now() - buildIdCacheTime < BUILD_ID_CACHE_MS) return buildIdCache;
  if (buildIdInflight) return buildIdInflight;

  buildIdInflight = (async () => {
    // 双重检查（Go 拿到锁后再查一次缓存）
    if (buildIdCache !== '' && Date.now() - buildIdCacheTime < BUILD_ID_CACHE_MS) return buildIdCache;

    let body = '';
    let status = 0;
    let lastErr: unknown = null;
    // Go：retry <= p.retries（共 3 次），指数退避 100ms * 2^(retry-1)
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      if (retry > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** (retry - 1)));
      try {
        const resp = await httpGet(WEBSITE_URL, HTML_HEADERS);
        status = resp.status;
        body = resp.body;
        if (status === 200) break;
      } catch (err) {
        lastErr = err;
      }
    }
    // 全部失败但旧缓存仍在有效语义内可降级（Go：请求失败/非200/读取失败均降级）
    if (status !== 200) {
      if (buildIdCache !== '') return buildIdCache;
      throw new Error(`[pansearch] 获取buildId失败: ${lastErr instanceof Error ? lastErr.message : `状态码 ${status}`}`);
    }
    const buildId = extractBuildId(body);
    if (buildId === '') {
      if (buildIdCache !== '') return buildIdCache;
      throw new Error('[pansearch] 未找到buildId');
    }
    buildIdCache = buildId;
    buildIdCacheTime = Date.now();
    return buildId;
  })();

  try {
    return await buildIdInflight;
  } finally {
    buildIdInflight = null;
  }
}

/** 拉取一页 JSON 接口（Go fetchFirstPage / fetchPage 共用逻辑） */
async function fetchAPIPage(baseURL: string, keyword: string, offset: number): Promise<{ items: PanSearchItem[]; total: number }> {
  const reqURL = `${baseURL}?keyword=${encodeURIComponent(keyword)}&offset=${offset}`;
  const { status, body } = await httpGet(reqURL, API_HEADERS);
  if (status === 404) throw new Error('404 Not Found，buildId可能已过期');
  if (status !== 200) throw new Error(`服务器返回非200状态码: ${status}`);

  const apiResp = JSON.parse(body) as PanSearchResponse;
  return {
    total: apiResp.pageProps?.data?.total ?? 0,
    items: apiResp.pageProps?.data?.data ?? [],
  };
}

interface LinkInfo {
  url: string;
  password: string;
}

/** 从内容 HTML 中提取链接与密码（Go extractLinkAndPassword） */
function extractLinkAndPassword(content: string): LinkInfo {
  try {
    const $ = cheerio.load(`<div>${content}</div>`);
    // cheerio 属性值已做 HTML 实体解码（对应 Go html.UnescapeString）
    const href = ($('a.resource-link, a[href]').first().attr('href') ?? '').trim();
    if (!href.startsWith('http://') && !href.startsWith('https://')) return { url: '', password: '' };

    let password = '';
    try {
      const parsed = new URL(href);
      for (const key of ['pwd', 'password', 'passcode', 'code']) {
        const value = (parsed.searchParams.get(key) ?? '').trim();
        if (value !== '') {
          password = value;
          break;
        }
      }
    } catch {
      /* URL 解析失败则仅从文本取密码 */
    }
    if (password === '') {
      const m = $.root().text().match(PASSWORD_REGEX);
      if (m) password = m[1];
    }
    return { url: href.replace(/#+$/, ''), password };
  } catch {
    return { url: '', password: '' };
  }
}

/** 清理 HTML 标签为多行纯文本（Go cleanHTML） */
function cleanHTML(value: string): string {
  value = value
    .replace(/<br>/g, '\n')
    .replace(/<br\/>/g, '\n')
    .replace(/<br \/>/g, '\n')
    .replace(/<\/p>/g, '\n');
  try {
    const $ = cheerio.load(`<div>${value}</div>`);
    const lines = $.root().text().split('\n');
    const cleaned: string[] = [];
    for (const line of lines) {
      const joined = line.replace(/\s+/g, ' ').trim();
      if (joined !== '') cleaned.push(joined);
    }
    return cleaned.join('\n');
  } catch {
    return value.trim();
  }
}

/** 从内容中提取标题：通常在「名称：」之后直到换行（Go extractTitle） */
function extractTitle(content: string, keyword: string): string {
  const titlePrefix = '名称：';
  const titleStartIndex = content.indexOf(titlePrefix);
  if (titleStartIndex === -1) return keyword; // 以搜索关键词作为默认标题

  const start = titleStartIndex + titlePrefix.length;
  const titleEndIndex = content.indexOf('\n', start);
  if (titleEndIndex === -1) return cleanHTML(content.slice(start));
  return cleanHTML(content.slice(start, titleEndIndex));
}

/** 归一化网盘类型：先看源站标注，再看 URL 域名（Go normalizePanSearchType） */
function normalizePanSearchType(rawType: string, rawURL: string): string {
  const normalized = rawType.trim().toLowerCase();
  if (['ali', 'alipan', 'aliyun', 'aliyundrive'].includes(normalized)) return 'aliyun';
  if (['quark', 'uc', 'baidu', 'xunlei', 'tianyi', '115', '123', 'mobile', 'pikpak'].includes(normalized)) return normalized;

  const lowerURL = rawURL.toLowerCase();
  if (lowerURL.includes('pan.quark.cn')) return 'quark';
  if (lowerURL.includes('drive.uc.cn')) return 'uc';
  if (lowerURL.includes('pan.baidu.com')) return 'baidu';
  if (lowerURL.includes('alipan.com') || lowerURL.includes('aliyundrive.com')) return 'aliyun';
  if (lowerURL.includes('pan.xunlei.com')) return 'xunlei';
  if (lowerURL.includes('cloud.189.cn')) return 'tianyi';
  if (lowerURL.includes('115.com')) return '115';
  if (lowerURL.includes('123pan') || lowerURL.includes('123865.com') || lowerURL.includes('123684.com')) return '123';
  if (lowerURL.includes('139.com') || lowerURL.includes('10086.cn')) return 'mobile';
  if (lowerURL.includes('pikpak')) return 'pikpak';
  return 'others';
}

/** 转换为标准 SearchResult（Go convertResults） */
function convertResults(items: PanSearchItem[], keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of items) {
    const linkInfo = extractLinkAndPassword(item.content);
    if (linkInfo.url === '') continue;

    const linkType = normalizePanSearchType(item.pan, linkInfo.url);
    const title = extractTitle(item.content, keyword);
    const link: Link = { type: linkType, url: linkInfo.url, password: linkInfo.password, work_title: title };

    let datetime = '';
    if (item.time !== '') {
      const parsed = new Date(item.time);
      if (!Number.isNaN(parsed.getTime())) datetime = parsed.toISOString(); // Go：RFC3339 解析失败为零值时间，这里置空
    }

    const result: SearchResult = {
      message_id: String(item.id),
      unique_id: `pansearch-${item.id}`,
      channel: '', // 插件结果 Channel 必须为空
      datetime,
      title,
      content: cleanHTML(item.content),
      links: [link],
      tags: [linkType, 'pansearch'],
    };
    const imageURL = item.image.trim();
    if (imageURL.startsWith('http://') || imageURL.startsWith('https://')) result.images = [imageURL];

    results.push(result);
  }
  return results;
}

export const pansearch = definePlugin({
  name: 'pansearch',
  priority: 3, // 中等优先级（Go NewBaseAsyncPlugin("pansearch", 3)）
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    keyword = keyword.trim();
    if (keyword === '') throw new Error('[pansearch] 关键词不能为空');

    let baseURL = BASE_URL_TEMPLATE.replace('%s', await getBuildId());

    // 首页（含总数）
    let first: { items: PanSearchItem[]; total: number };
    try {
      first = await fetchAPIPage(baseURL, keyword, 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404') || msg.includes('Not Found')) {
        // buildId 过期：清缓存重取后重试一次
        buildIdCache = '';
        buildIdCacheTime = 0;
        baseURL = BASE_URL_TEMPLATE.replace('%s', await getBuildId());
        first = await fetchAPIPage(baseURL, keyword, 0);
      } else {
        throw err;
      }
    }

    const allResults: PanSearchItem[] = [...first.items];
    const pageCount = Math.min(Math.ceil(Math.min(first.total, MAX_RESULTS) / PAGE_SIZE), MAX_API_PAGES);
    if (pageCount > 1) {
      // 并发拉取后续页（Go：semaphore min(maxConcurrent, pageCount-1)，结果按 offset 排序后合并）
      const limit = createLimiter(Math.min(MAX_CONCURRENT, pageCount - 1));
      const offsets: number[] = [];
      for (let page = 1; page < pageCount; page++) offsets.push(page * PAGE_SIZE);
      const settled = await Promise.allSettled(
        offsets.map((offset) => limit(() => fetchAPIPage(baseURL, keyword, offset).then((r) => ({ offset, items: r.items })))),
      );
      const pages = settled
        .filter((s): s is PromiseFulfilledResult<{ offset: number; items: PanSearchItem[] }> => s.status === 'fulfilled')
        .map((s) => s.value)
        .sort((a, b) => a.offset - b.offset);
      for (const page of pages) allResults.push(...page.items);
    }

    // 按资源 ID 去重（Go uniqueMap[item.ID] = item：后写覆盖）
    const uniqueMap = new Map<number, PanSearchItem>();
    for (const item of allResults) uniqueMap.set(item.id, item);
    return convertResults([...uniqueMap.values()], keyword);
  },
});
