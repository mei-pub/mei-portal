// SuSu 影视插件 —— Go plugin/susu 的代码级移植
// WordPress B2 主题站点：搜索页定位帖子 → REST API（getDownloadData/getDownloadPageData）
// 逐按钮解出真实网盘链接（JWT payload 内嵌 url）。
// 说明：Go 版各 sync.Map 缓存（帖子ID/按钮列表/按钮详情/JWT/链接类型）以模块级 Map 等价复刻，
//       每小时定时清空（Go startCacheCleaner，unref 不阻止进程退出）；
//       md5sum 为 Go 的简化哈希缓存键实现，Map 直接以原始 html 为键，无哈希必要。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

const BASE_URL = 'https://susuifa.com';
const SEARCH_URL = `${BASE_URL}/?type=post&s=`;
const BUTTON_LIST_URL = `${BASE_URL}/?rest_route=/b2/v1/getDownloadData`;
const BUTTON_DETAIL_URL = `${BASE_URL}/?rest_route=/b2/v1/getDownloadPageData`;
const MAX_RETRIES = 1; // 额外重试次数（Go 循环 0..maxRetries，共 2 次尝试）
const MAX_CONCURRENCY = 4;

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface DownloadButton {
  name?: string;
  link?: string;
  url?: string;
  attr?: { tq?: string; jy?: string };
}

interface DownloadGroup {
  button?: DownloadButton[];
}

interface ButtonDetailResponse {
  button?: DownloadButton;
}

// ===== 模块级缓存（Go sync.Map + 每小时清空） =====
const postIDCache = new Map<string, string>();
const buttonListCache = new Map<string, Link[]>();
const buttonDetailCache = new Map<string, Link>();
const jwtDecodeCache = new Map<string, string>();
const linkTypeCache = new Map<string, string>();

const cleaner = setInterval(() => {
  postIDCache.clear();
  buttonListCache.clear();
  buttonDetailCache.clear();
  jwtDecodeCache.clear();
  linkTypeCache.clear();
}, 60 * 60 * 1000);
cleaner.unref(); // Go goroutine 对应物：不阻止进程退出

/** 浏览器请求头（Go setBrowserHeaders） */
function browserHeaders(referer: string): Record<string, string> {
  return {
    'User-Agent': getRandomUA(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer,
  };
}

/** API 请求头（Go setAPIHeaders） */
function apiHeaders(referer: string): Record<string, string> {
  return {
    ...browserHeaders(referer),
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    Origin: BASE_URL,
  };
}

/**
 * 带重试的请求（Go doRequestWithRetry + isRetriableError）：
 * 网络层错误（连接拒绝/重置/EOF/超时——fetch reject 的全部情形）按指数退避重试；
 * HTTP 状态码非 200 不重试（Go 在 err==nil 时直接退出循环），由调用方检查状态码。
 */
async function requestWithRetry(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); // Go：ctx 跨重试共享同一个超时
  try {
    for (let i = 0; i <= MAX_RETRIES; i++) {
      if (i > 0) {
        const backoff = Math.min(500 * 2 ** (i - 1), 5_000); // 指数退避，上限 5s
        await new Promise((r) => setTimeout(r, backoff));
      }
      try {
        return await fetch(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (err) {
        lastErr = err; // 网络错误 → 重试
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 JWT token 获取真实链接（Go decodeJWTURL） */
function decodeJWTURL(jwtToken: string): string {
  if (jwtToken.startsWith('http://') || jwtToken.startsWith('https://')) return jwtToken;

  const cached = jwtDecodeCache.get(jwtToken);
  if (cached !== undefined) return cached;

  const parts = jwtToken.split('.');
  if (parts.length !== 3) throw new Error('无效的JWT格式');

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as { data?: { url?: string } };
  const url = (payload.data?.url ?? '').trim();
  if (url === '') throw new Error('JWT Payload中没有链接');

  jwtDecodeCache.set(jwtToken, url);
  return url;
}

/** 从 URL 查询参数或按钮属性提取密码（Go extractPassword） */
function extractLinkPassword(rawURL: string, fallback: string): string {
  try {
    const parsed = new URL(rawURL);
    for (const key of ['pwd', 'password', 'passcode', 'code']) {
      const value = (parsed.searchParams.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* URL 非法时直接用 fallback */
  }
  return fallback.trim();
}

/** 根据URL和名称确定链接类型（Go determineLinkType，含缓存） */
function determineLinkType(url: string, name: string): string {
  const cacheKey = `${url}:${name}`;
  const cached = linkTypeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const lowerURL = url.toLowerCase();
  const lowerName = name.toLowerCase();
  let linkType: string;

  if (lowerURL.includes('pan.baidu.com')) linkType = 'baidu';
  else if (lowerURL.includes('alipan.com') || lowerURL.includes('aliyundrive.com')) linkType = 'aliyun';
  else if (lowerURL.includes('pan.xunlei.com')) linkType = 'xunlei';
  else if (lowerURL.includes('pan.quark.cn')) linkType = 'quark';
  else if (lowerURL.includes('cloud.189.cn')) linkType = 'tianyi';
  else if (lowerURL.includes('115.com')) linkType = '115';
  else if (lowerURL.includes('drive.uc.cn')) linkType = 'uc';
  else if (lowerURL.includes('caiyun.139.com')) linkType = 'mobile';
  else if (lowerURL.includes('123pan.com')) linkType = '123';
  else if (lowerURL.includes('mypikpak.com')) linkType = 'pikpak';
  else if (lowerName.includes('百度')) linkType = 'baidu';
  else if (lowerName.includes('阿里')) linkType = 'aliyun';
  else if (lowerName.includes('迅雷')) linkType = 'xunlei';
  else if (lowerName.includes('夸克')) linkType = 'quark';
  else if (lowerName.includes('天翼')) linkType = 'tianyi';
  else if (lowerName.includes('115')) linkType = '115';
  else if (lowerName.includes('uc')) linkType = 'uc';
  else if (lowerName.includes('移动') || lowerName.includes('彩云')) linkType = 'mobile';
  else if (lowerName.includes('123')) linkType = '123';
  else if (lowerName.includes('pikpak')) linkType = 'pikpak';
  else linkType = 'others';

  linkTypeCache.set(cacheKey, linkType);
  return linkType;
}

/** 从搜索结果项提取帖子ID（Go extractPostID，含缓存） */
function extractPostID(html: string, itemIDAttr: string | undefined, href: string | undefined): string {
  const cacheKey = `postid:${html}`;
  const cached = postIDCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // 方法1：列表项 id 属性（item-<id>）
  if (itemIDAttr !== undefined && itemIDAttr.startsWith('item-')) {
    const postID = itemIDAttr.slice('item-'.length);
    postIDCache.set(cacheKey, postID);
    return postID;
  }
  // 方法2：详情页链接 /<id>.html
  if (href !== undefined) {
    const m = href.match(/\/(\d+)\.html/);
    if (m) {
      postIDCache.set(cacheKey, m[1]);
      return m[1];
    }
  }
  return '';
}

/** 获取按钮详情并解出真实链接（Go getButtonDetail，含缓存） */
async function getButtonDetail(postID: string, index: number, i: number): Promise<Link> {
  const cacheKey = `${postID}:${index}:${i}`;
  const cached = buttonDetailCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const form = new URLSearchParams({ post_id: postID, index: String(index), i: String(i), guest: '' });
  const resp = await requestWithRetry(
    BUTTON_DETAIL_URL,
    {
      method: 'POST',
      headers: apiHeaders(`${BASE_URL}/download?post_id=${postID}&index=${index}&i=${i}`),
      body: form.toString(),
    },
    20_000,
  );
  if (resp.status !== 200) throw new Error(`[susu] 按钮详情请求返回状态码: ${resp.status}`);

  const detail = (await resp.json()) as ButtonDetailResponse;
  const buttonURL = detail.button?.url ?? '';
  if (buttonURL === '') throw new Error('[susu] 按钮URL为空');

  const realURL = decodeJWTURL(buttonURL).trim();
  let parsed: URL;
  try {
    parsed = new URL(realURL);
  } catch {
    throw new Error('[susu] 按钮返回无效链接');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.host === '') {
    throw new Error('[susu] 按钮返回无效链接');
  }

  const link: Link = {
    url: realURL,
    type: determineLinkType(realURL, detail.button?.name ?? ''),
    password: extractLinkPassword(realURL, detail.button?.attr?.tq ?? ''),
  };
  buttonDetailCache.set(cacheKey, link);
  return link;
}

/** 获取帖子的全部网盘链接（Go getLinks，含缓存） */
async function getLinks(postID: string): Promise<Link[]> {
  const cached = buttonListCache.get(postID);
  if (cached !== undefined) return cached;

  const form = new URLSearchParams({ post_id: postID, guest: '' });
  const resp = await requestWithRetry(
    BUTTON_LIST_URL,
    { method: 'POST', headers: apiHeaders(`${BASE_URL}/${postID}.html`), body: form.toString() },
    20_000,
  );
  if (resp.status !== 200) throw new Error(`[susu] 按钮列表请求返回状态码: ${resp.status}`);

  const groups = (await resp.json()) as DownloadGroup[];
  const buttons: Array<[number, number]> = [];
  groups.forEach((group, index) => {
    (group.button ?? []).forEach((_b, i) => buttons.push([index, i]));
  });
  if (buttons.length === 0) throw new Error(`[susu] 帖子 ${postID} 没有可用下载按钮`);

  // 并发获取各按钮详情（Go 信号量 MaxConcurrency=4）
  const limit = createLimiter(MAX_CONCURRENCY);
  const settled = await Promise.allSettled(buttons.map(([index, i]) => limit(() => getButtonDetail(postID, index, i))));

  // 收集并去重（type+url+password）
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const link = s.value;
    if (link.url === '') continue;
    const key = `${link.type}\x00${link.url}\x00${link.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  if (links.length === 0) throw new Error(`[susu] 帖子 ${postID} 的下载按钮均未返回有效链接`);

  buttonListCache.set(postID, links);
  return links;
}

/** 解析 datetime 属性（"2006-01-02 15:04:05"，Go time.Parse 无时区 → UTC） */
function parseDatetime(datetimeAttr: string | undefined): string {
  if (!datetimeAttr) return '';
  const m = datetimeAttr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return '';
  const d = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export const susu = definePlugin({
  name: 'susu',
  priority: 1, // 高优先级
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${SEARCH_URL}${encodeURIComponent(keyword)}`;

    const resp = await requestWithRetry(searchURL, { method: 'GET', headers: browserHeaders(`${BASE_URL}/`) }, 30_000);
    if (resp.status !== 200) throw new Error(`[susu] 搜索请求返回状态码: ${resp.status}`);

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 多关键词（空格分割，AND），全部命中标题才进入详情抓取（Go 预过滤逻辑）
    const lowerKeyword = keyword.toLowerCase();
    const keywords = lowerKeyword.split(/\s+/).filter((k) => k !== '');

    const items: Array<{ postID: string; title: string; content: string; datetime: string; tags: string[] }> = [];
    $('.post-list-item').each((_i, el) => {
      const s = $(el);
      const title = (s.find('.post-info h2 a').text() ?? '').trim();
      const lowerTitle = title.toLowerCase();
      const content = (s.find('.post-excerpt').text() ?? '').trim();

      // 检查每个关键词是否在标题中（Go 实际只比对标题）
      const matched = keywords.every((kw) => lowerTitle.includes(kw));
      if (!matched) return;

      // 提取帖子ID
      const postID = extractPostID(
        $.html(el) ?? '',
        s.attr('id'),
        s.find('.post-info h2 a').attr('href'),
      );
      if (postID === '') return;

      // 分类标签
      const tags: string[] = [];
      s.find('.post-list-cat-item').each((_j, t) => {
        const tag = $(t).text().trim();
        if (tag !== '') tags.push(tag);
      });

      items.push({
        postID,
        title,
        content,
        datetime: parseDatetime(s.find('.list-footer time.b2timeago').attr('datetime')),
        tags,
      });
    });

    // 并发处理各帖子获取网盘链接（Go 信号量 MaxConcurrency=4）；失败/无链接的帖子丢弃
    const limit = createLimiter(MAX_CONCURRENCY);
    const settled = await Promise.allSettled(items.map((item) => limit(() => getLinks(item.postID))));

    const results: SearchResult[] = [];
    settled.forEach((s, idx) => {
      if (s.status !== 'fulfilled' || s.value.length === 0) return;
      const item = items[idx];
      results.push({
        message_id: '',
        unique_id: `susu-${item.postID}`,
        channel: '', // 插件结果 Channel 必须为空
        datetime: item.datetime, // Go 零值 → 空字符串
        title: item.title,
        content: item.content,
        links: s.value,
        tags: item.tags.length > 0 ? item.tags : undefined,
      });
    });

    // 预过滤阶段已按关键词筛选，不再调用 FilterResultsByKeyword（与 Go 一致）
    return results;
  },
});
