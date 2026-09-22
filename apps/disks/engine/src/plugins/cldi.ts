// 磁力帝（DHT 磁力搜索）插件 —— Go plugin/cldi 的复刻
//
// 磁力帝是轮换域名的 DHT 磁力引擎（zsky 模板），入口域名不定期失效，
// 官方提供「御选入口」落地页发布当前有效地址：
//   - 落地页 https://cldcld.cc/（长期入口；旧入口 cm7jll1f.1122137.xyz
//     失效时返回 410 并 meta-refresh 指向当前落地页，可作回退）
//   - 落地页内嵌 JS：CONFIG={domains:[...], intervalMinutes:30, codeLength:8,
//     salt:"..."}，当前入口由确定性算法生成（每 30 分钟轮换）
//
// 搜索接口：
//   - GET /search-<keyword>-0-<sort>-<page>.html（sort 0=相关 2=时间）
//   - 结果卡 <article class="resource"> 内 <h2><a href="/hash/<40位hash>.html">
//   - href 中的 hash 即 btih，直接构造 magnet 链接，无需请求详情页

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'cldi';
const MAX_CONCURRENCY = 10; // 翻页并发上限（Go semaphore）
const MAX_PAGES = 5;
const PAGE_TIMEOUT = 30_000;
const LANDING_TIMEOUT = 15_000;
const ENTRY_CACHE_MS = 20 * 60 * 1000; // 入口候选缓存 20 分钟
const RE_RESOLVE_THROTTLE_MS = 60_000; // 无结果强制重解析限频 1 分钟

// 广告清理正则
const AD_REGEX = /【[^】]*】/g;
// 文件大小和名称分离正则（作用于 li 的序列化 HTML）
const FILE_SIZE_REGEX = /^(.+?)&nbsp;<span class="lightColor">([^<]+)<\/span>$/;
const HASH_PATH_REGEX = /\/hash\/([a-f0-9]{40})\.html/i;
// 落地页 CONFIG 解析
const CONFIG_REGEX = /CONFIG=\{domains:\[([^\]]*)\],intervalMinutes:(\d+),codeLength:(\d+),salt:"([^"]*)"\}/;
// 旧入口 410 页的 meta refresh 跳转目标
const META_REFRESH_REGEX = /url=(https?:\/\/[^"'>\s]+)/i;
const ADD_TIME_REGEX = /添加时间[:：]\s*(\d{4}-\d{2}-\d{2})/;

// 落地页（御选入口）。cldcld.cc 为当前长期落地页；1122137.xyz 根域在入口
// 失效后会 410 并 meta-refresh 到新落地页，作为第二引导源。
const LANDING_PAGES = ['https://cldcld.cc/', 'https://cm7jll1f.1122137.xyz/'];

const LANDING_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// 落地页不可用时的兜底配置
interface RotationConfig {
  domains: string[];
  intervalMinutes: number;
  codeLength: number;
  salt: string;
}

const DEFAULT_CONFIG: RotationConfig = {
  domains: ['1122137.xyz', '1122138.xyz', 'cld142.buzz'],
  intervalMinutes: 30,
  codeLength: 8,
  salt: 'address-page-2026',
};

/** 入口候选缓存（事件循环单线程，无需互斥锁） */
let cachedEntries: { bases: string[]; expires: number } | null = null;
let lastReResolve = 0; // 上次强制重解析时间（限频）

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** FNV-1a 32 位哈希（与落地页 JS 的 hash32 一致，种子全 ASCII） */
function hash32(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** xorshift32 伪随机序列生成入口前缀（与落地页 JS 一致） */
function seededCode(seedText: string, length: number): string {
  let state = hash32(seedText);
  if (state === 0) state = 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    out += CODE_ALPHABET[state % CODE_ALPHABET.length];
  }
  return out;
}

/** 解析落地页内嵌的 CONFIG */
function parseConfig(page: string): RotationConfig | null {
  const m = page.match(CONFIG_REGEX);
  if (!m) return null;
  const interval = Number(m[2]);
  const codeLen = Number(m[3]);
  if (!Number.isInteger(interval) || !Number.isInteger(codeLen) || codeLen <= 0 || interval <= 0) return null;
  const domains: string[] = [];
  for (const d of m[1].split(',')) {
    const trimmed = d.trim().replaceAll('"', '');
    if (trimmed !== '') domains.push(trimmed);
  }
  if (domains.length === 0) return null;
  return { domains, intervalMinutes: interval, codeLength: codeLen, salt: m[4] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 最小化 GET（不重试，调用方容错；跟进一层 meta refresh） */
async function simpleGet(target: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LANDING_TIMEOUT);
  try {
    const resp = await fetch(target, { headers: LANDING_HEADERS, signal: controller.signal });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const page = await resp.text();
    // 旧入口 410 页面通过 meta refresh 指向新落地页，跟进一层
    const m = page.match(META_REFRESH_REGEX);
    if (m && /http-equiv=refresh/i.test(page)) {
      try {
        return await simpleGet(m[1]);
      } catch {
        /* 跟进失败保留原页面 */
      }
    }
    return page;
  } finally {
    clearTimeout(timer);
  }
}

/** 按落地页算法生成全部候选入口（顺序即优先级） */
function computeEntries(cfg: RotationConfig): string[] {
  const intervalMinutes = cfg.intervalMinutes > 0 ? cfg.intervalMinutes : 30;
  const codeLength = cfg.codeLength > 0 ? cfg.codeLength : 8;
  const slot = Math.floor(Date.now() / (intervalMinutes * 60_000));
  const entries: string[] = [];
  cfg.domains.forEach((rawHost, i) => {
    // Go strings.Trim(host, "./")：去除首尾的 '.' 与 '/'（cutset 语义）
    const host = rawHost.trim().replace(/^[./]+|[./]+$/g, '');
    if (host === '') return;
    const seed = `${cfg.salt}|${host}|${slot}|${i}`;
    entries.push(`https://${seededCode(seed, codeLength)}.${host}`);
  });
  return entries;
}

/** 从落地页解析当前候选入口；落地页全挂时用兜底配置计算 */
async function resolveBases(): Promise<string[]> {
  let cfg = DEFAULT_CONFIG;
  for (const landing of LANDING_PAGES) {
    try {
      const page = await simpleGet(landing);
      const parsed = parseConfig(page);
      if (parsed) {
        cfg = parsed;
        break;
      }
    } catch {
      continue;
    }
  }
  return computeEntries(cfg);
}

/** 入口请求失败时清除缓存，允许下次搜索立刻重解析 */
function invalidateEntries(): void {
  cachedEntries = null;
}

/** 返回当前候选入口列表（带缓存与轮换解析） */
async function currentBases(): Promise<string[]> {
  const cached = cachedEntries;
  if (cached && Date.now() < cached.expires) return cached.bases;

  const bases = await resolveBases();
  if (bases.length === 0) {
    if (cached) {
      // 解析失败时沿用旧候选碰运气（可能只是落地页抖动）
      return cached.bases;
    }
    throw new Error(`[${PLUGIN_NAME}] 无法解析入口域名`);
  }
  cachedEntries = { bases, expires: Date.now() + ENTRY_CACHE_MS };
  return bases;
}

const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

/** 抓取搜索页（3 次重试，指数退避 200ms/400ms，非 200 视为失败） */
async function fetchSearchPage(searchURL: string, referer: string): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(200 * 2 ** (i - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT);
    try {
      const resp = await fetch(searchURL, { headers: { ...SEARCH_HEADERS, Referer: referer }, signal: controller.signal });
      if (resp.status === 200) return await resp.text();
      lastErr = new Error(`[${PLUGIN_NAME}] 请求返回状态码: ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[${PLUGIN_NAME}] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 清理标题中的广告内容（去【】内文本、折叠空白） */
function cleanTitle(title: string): string {
  return title.replace(AD_REGEX, '').replace(/\s+/g, ' ').trim();
}

/** 旧模板：映射分类 */
function mapCategory(category: string): string {
  const c = category.replaceAll('[', '').replaceAll(']', '');
  const table: Record<string, string> = {
    影视: '影视',
    音乐: '音乐',
    图像: '图像',
    文档书籍: '文档',
    压缩文件: '压缩包',
    安装包: '软件',
    其他: '其他',
  };
  return table[c] ?? '其他';
}

/** 新模板：article.resource 结果卡 */
function extractNewResults($: cheerio.CheerioAPI): SearchResult[] {
  const results: SearchResult[] = [];
  $('article.resource').each((_i, article) => {
    const anchor = $(article).find('h2 a[href]').first();
    const href = (anchor.attr('href') ?? '').trim();
    const match = href.match(HASH_PATH_REGEX);
    if (!match) return;
    const title = cleanTitle(anchor.text());
    if (title === '') return;
    const content = $(article).find('.meta').text().trim();

    let datetime = new Date().toISOString();
    const dm = content.match(ADD_TIME_REGEX);
    if (dm) {
      // Go time.ParseInLocation 失败 → 保持默认时间；正则只保证形状，语义非法日期需校验
      const parsed = new Date(`${dm[1]}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) datetime = parsed.toISOString();
    }

    const id = match[1].toLowerCase();
    results.push({
      message_id: `${PLUGIN_NAME}-${id}`,
      unique_id: `${PLUGIN_NAME}-${id}`,
      channel: '',
      datetime,
      title,
      content,
      links: [{ type: 'magnet', url: `magnet:?xt=urn:btih:${id}`, password: '', work_title: title }],
    });
  });
  return results;
}

/** 旧模板：解析单个 .tbox .ssbox 搜索结果 */
function parseOldResult($: cheerio.CheerioAPI, s: cheerio.Cheerio<any>): SearchResult | null {
  const titleSection = s.find('.title h3');
  const result: SearchResult = {
    message_id: '',
    unique_id: '', // Go 用 time.Now().UnixNano() 兜底唯一 ID
    channel: '',
    datetime: new Date().toISOString(),
    title: '',
    content: '',
    links: [],
  };

  const category = titleSection.find('span').first().text().trim();
  if (category !== '') result.tags = [mapCategory(category)];

  result.title = cleanTitle(titleSection.find('a').text().trim());

  // 磁力链接
  const sbar = s.find('.sbar');
  const magnetLink = sbar.find("a[href^='magnet:']").attr('href');
  if (magnetLink) result.links = [{ type: 'magnet', url: magnetLink, password: '' }];

  // 添加时间
  sbar.find('span').each((_i, span) => {
    if (!$(span).text().includes('添加时间:')) return;
    const timeStr = $(span).find('b').text().trim();
    if (timeStr !== '') {
      const parsed = new Date(`${timeStr}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) result.datetime = parsed.toISOString();
    }
  });

  // 文件列表作为内容
  const fileList: string[] = [];
  s.find('.slist ul li').each((_i, li) => {
    const html = $.html(li) ?? '';
    const m = html.match(FILE_SIZE_REGEX);
    if (m) {
      const fileName = m[1].trim();
      const fileSize = m[2].trim();
      if (fileName !== '' && fileSize !== '') fileList.push(`${fileName} (${fileSize})`);
    } else {
      const text = $(li).text().trim();
      if (text !== '') fileList.push(text);
    }
  });
  if (fileList.length > 0) result.content = fileList.join('\n');

  if (result.title === '' || result.links.length === 0) return null;
  result.unique_id = `${PLUGIN_NAME}-${process.hrtime.bigint().toString()}`;
  return result;
}

function extractSearchResults($: cheerio.CheerioAPI): SearchResult[] {
  const newResults = extractNewResults($);
  if (newResults.length > 0) return newResults;

  const results: SearchResult[] = [];
  $('.tbox .ssbox').each((_i, s) => {
    const parsed = parseOldResult($, s);
    if (parsed) results.push(parsed);
  });
  return results;
}

/** 搜索指定页面（分类=0全部, 排序=2按添加时间） */
async function searchPage(base: string, keyword: string, page: number): Promise<SearchResult[]> {
  const searchURL = `${base}/search-${encodeURIComponent(keyword)}-0-2-${page}.html`;
  const body = await fetchSearchPage(searchURL, `${base}/`);
  const $ = cheerio.load(body);
  return extractSearchResults($);
}

/** 依次尝试候选入口，首个成功者完成全部页码搜索并合并 */
async function searchAllPages(bases: string[], keyword: string): Promise<SearchResult[]> {
  for (const base of bases) {
    // 1. 首先搜索第一页（入口探活：请求成功或拿到结果都算可用）
    let firstPageResults: SearchResult[];
    try {
      firstPageResults = await searchPage(base, keyword, 1);
    } catch {
      continue; // 换下一个候选入口
    }
    if (firstPageResults.length === 0) return []; // 入口可用但无结果，无需换域名

    const allResults = [...firstPageResults];

    // 2. 并发搜索其他页面（第 2 页到第 5 页），信号量控制并发
    if (MAX_PAGES > 1) {
      const limit = createLimiter(MAX_CONCURRENCY);
      const pageResults = new Map<number, SearchResult[]>();
      const pages: number[] = [];
      for (let p = 2; p <= MAX_PAGES; p++) pages.push(p);
      await Promise.all(
        pages.map(async (pageNum) =>
          limit(async () => {
            // 添加小延迟避免过于频繁的请求
            await sleep((pageNum % 3) * 100);
            try {
              const r = await searchPage(base, keyword, pageNum);
              if (r.length > 0) pageResults.set(pageNum, r);
            } catch {
              /* 单页失败忽略 */
            }
          }),
        ),
      );
      // 按页码顺序合并所有页面的结果
      for (let p = 2; p <= MAX_PAGES; p++) {
        const r = pageResults.get(p);
        if (r) allResults.push(...r);
      }
    }

    return allResults;
  }
  return [];
}

export const cldi = definePlugin({
  name: PLUGIN_NAME,
  priority: 3,
  skipServiceFilter: true, // 磁力搜索插件，跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const bases = await currentBases();

    const results = await searchAllPages(bases, keyword);
    if (results.length > 0) return filterResultsByKeyword(results, keyword);

    // 无结果可能是入口刚好轮换（30 分钟周期），限频强制重解析一次
    if (Date.now() - lastReResolve >= RE_RESOLVE_THROTTLE_MS) {
      lastReResolve = Date.now();
      invalidateEntries();
      try {
        const newBases = await currentBases();
        const retry = await searchAllPages(newBases, keyword);
        if (retry.length > 0) return filterResultsByKeyword(retry, keyword);
      } catch {
        /* 重解析失败忽略 */
      }
    }
    return [];
  },
});
