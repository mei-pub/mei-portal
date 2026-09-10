// 灵犀笔记（JsNoteClub）插件 —— Go plugin/jsnoteclub/jsnoteclub.go 的复刻
// Ghost CMS 站点：首页 <script> 提取 data-key → Ghost Content API 拉全量文章 →
// 关键词匹配（title+excerpt+slug，AND）→ 并发抓详情页（gh-content 区域 + 纯文本兜底）提取网盘链接。
// 说明：Go 的 HTTP 连接池参数未移植；detailCache 清理协程未移植（读取时已做懒过期，
// 语义等价）；postsCache 以模块级单条目复刻（事件循环下无锁）。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'jsnoteclub';
const SITE_URL = 'https://jsnoteclub.com';

// 超时 / 重试 / 并发（Go 常量逐条对齐）
const REQUEST_TIMEOUT = 12_000; // Go requestTimeout
const DETAIL_TIMEOUT = 10_000; // Go detailTimeout
const MAX_REQUEST_RETRIES = 3; // Go maxRequestRetries：总尝试次数
const RETRY_BASE_DELAY = 200; // Go retryBaseDelay，指数退避 200ms * 2^attempt
const MAX_MATCHED_POSTS = 30; // Go maxMatchedPosts
const MAX_DETAIL_WORKERS = 8; // Go maxDetailWorkers → createLimiter
const POSTS_CACHE_TTL = 3_600_000; // Go postsCacheTTL 1h
const DETAIL_CACHE_TTL = 3_600_000; // Go detailCacheTTL 1h

// Ghost keys may contain suffixes such as "_blocked" in addition to hex characters.
const DATA_KEY_REGEX = /data-key="([^"]+)"/;

// 网盘链接分类正则（Go linkPatterns 原样搬运，顺序即优先级）
const LINK_PATTERNS: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+/, type: 'quark' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/, type: 'xunlei' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+/, type: 'baidu' },
  { re: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/, type: 'aliyun' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, type: 'uc' },
  { re: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/, type: '123' },
  { re: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/, type: 'pikpak' },
  { re: /https?:\/\/caiyun\.139\.com\/[^\s<>"']+/, type: 'mobile' },
  { re: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, type: 'magnet' },
  { re: /ed2k:\/\/[^\s<>"']+/, type: 'ed2k' },
];

// 密码提取正则（Go passwordPatterns 原样搬运，顺序即优先级）
const PASSWORD_PATTERNS = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/g;

// 请求头（Go setHTMLHeaders / setAPIHeaders）
const HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

interface GhostPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
  updated_at: string;
  visibility: string;
}

interface GhostPostsResponse {
  posts: GhostPost[];
}

// 文章列表缓存（Go postsCache：单条目 + TTL，事件循环下无锁）
const postsCache: { entries: GhostPost[]; expire: number } = { entries: [], expire: 0 };

// 详情页链接缓存（Go detailCache：懒过期，清理协程未移植）
const detailCache = new Map<string, { links: Link[]; expiresAt: number }>();

/**
 * 带重试的抓取（Go doRequestWithRetry）：共 MAX_REQUEST_RETRIES 次尝试，要求 200，
 * 退避 200ms * 2^attempt；整个重试过程共享同一个超时（Go 的 ctx 跨克隆请求生效）。
 */
async function requestWithRetry(
  url: string,
  headers: Record<string, string>,
  referer: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_REQUEST_RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY * 2 ** (attempt - 1)));
      try {
        const resp = await fetch(url, {
          headers: { ...headers, Referer: referer },
          signal: controller.signal,
          redirect: 'follow',
        });
        if (resp.status === 200) return await resp.text();
        lastErr = new Error(`HTTP 状态码 ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`重试 ${MAX_REQUEST_RETRIES} 次后失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 从首页 script 标签中提取 Ghost data-key（Go fetchDataKey） */
async function fetchDataKey(): Promise<string> {
  const html = await requestWithRetry(`${SITE_URL}/`, HTML_HEADERS, `${SITE_URL}/`, REQUEST_TIMEOUT);
  const $ = cheerio.load(html);
  let scriptHTML = '';
  $('script').each((_i, el) => {
    scriptHTML += $.html($(el)); // goquery.OuterHtml
  });
  const match = DATA_KEY_REGEX.exec(scriptHTML);
  if (!match) throw new Error(`[${PLUGIN_NAME}] 未能在首页找到 data-key`);
  return match[1];
}

/** 经 Ghost Content API 拉取全量文章（Go fetchPosts） */
async function fetchPosts(dataKey: string): Promise<GhostPost[]> {
  const params = new URLSearchParams();
  params.set('key', dataKey);
  params.set('limit', '10000');
  params.set('fields', 'id,slug,title,excerpt,url,updated_at,visibility');
  params.set('order', 'updated_at DESC');

  const body = await requestWithRetry(
    `${SITE_URL}/ghost/api/content/posts/?${params.toString()}`,
    API_HEADERS,
    `${SITE_URL}/`,
    REQUEST_TIMEOUT,
  );
  const payload = JSON.parse(body) as GhostPostsResponse;
  return payload.posts ?? [];
}

/** 全量文章（带 1h 缓存，Go getAllPosts） */
async function getAllPosts(): Promise<GhostPost[]> {
  if (postsCache.entries.length > 0 && Date.now() < postsCache.expire) {
    return postsCache.entries;
  }
  const dataKey = await fetchDataKey();
  const posts = await fetchPosts(dataKey);
  postsCache.entries = posts;
  postsCache.expire = Date.now() + POSTS_CACHE_TTL;
  return posts;
}

/** 链接分类：返回首个命中正则的类型与匹配片段（Go classifyLink） */
function classifyLink(raw: string): { type: string; normalized: string } {
  for (const { re, type } of LINK_PATTERNS) {
    const m = re.exec(raw);
    if (m) return { type, normalized: m[0] };
  }
  return { type: '', normalized: '' };
}

/** 从文本匹配密码（Go matchPassword） */
function matchPassword(text: string): string {
  text = text.trim();
  if (text === '') return '';
  for (const pattern of PASSWORD_PATTERNS) {
    const m = pattern.exec(text);
    if (m) return m[1].trim();
  }
  return '';
}

/** 锚点密码：node 文本 / title / 父节点 / 父节点下一节点 / 下一兄弟（Go extractPassword） */
function extractPasswordFromNode(sel: Sel): string {
  const candidates: string[] = [sel.text()];
  const title = sel.attr('title');
  if (title !== undefined) candidates.push(title);
  const parent = sel.parent();
  if (parent.length > 0) {
    candidates.push(parent.text());
    const parentNext = parent.next();
    if (parentNext.length > 0) candidates.push(parentNext.text());
  }
  const next = sel.next();
  if (next.length > 0) candidates.push(next.text());

  for (const c of candidates) {
    const pwd = matchPassword(c);
    if (pwd !== '') return pwd;
  }
  return '';
}

/** 选择器包装类型（ Cheerio 通用形态，等价 goquery.Selection 的使用面） */
// deno-lint-ignore no-explicit-any
type Sel = cheerio.Cheerio<any>;

/** 从内容区域提取链接：锚点优先，纯文本 URL 兜底（Go extractLinksFromSelection） */
function extractLinksFromSelection($: cheerio.CheerioAPI, sel: Sel): Link[] {
  const results: Link[] = [];
  const seen = new Set<string>();

  sel.find('a[href]').each((_i, node) => {
    const href = ($(node).attr('href') ?? '').trim();
    if (href === '') return;
    const { type, normalized } = classifyLink(href);
    if (type === '') return;
    if (seen.has(normalized)) return;
    const password = extractPasswordFromNode($(node));
    results.push({ type, url: normalized, password });
    seen.add(normalized);
  });

  const text = sel.text();
  const textURLs = text.match(TEXT_URL_REGEX) ?? [];
  for (const raw of textURLs) {
    const { type, normalized } = classifyLink(raw);
    if (type === '') continue;
    if (seen.has(normalized)) continue;
    // 密码取链接前后 80 字符上下文
    const idx = text.indexOf(raw);
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + raw.length + 80);
    const password = matchPassword(text.slice(start, end));
    results.push({ type, url: normalized, password });
    seen.add(normalized);
  }

  return results;
}

/** 抓详情页并提取链接（Go fetchDetailLinks；缓存懒过期） */
async function fetchDetailLinks(detailURL: string): Promise<Link[]> {
  const cached = detailCache.get(detailURL);
  if (cached && Date.now() < cached.expiresAt) return cached.links;
  if (cached) detailCache.delete(detailURL);

  let html: string;
  try {
    html = await requestWithRetry(detailURL, HTML_HEADERS, detailURL, DETAIL_TIMEOUT);
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  let content: Sel = $('section.gh-content');
  if (content.length === 0) content = $('.gh-content');
  if (content.length === 0) content = $('article');
  if (content.length === 0) content = $.root(); // doc.Selection：整个文档

  content.find('aside').remove();
  content.find('.gh-sidebar').remove();
  content.find('.sidebar-left').remove();
  content.find('.left-ads').remove();

  const links = extractLinksFromSelection($, content);
  if (links.length > 0) {
    detailCache.set(detailURL, { links, expiresAt: Date.now() + DETAIL_CACHE_TTL });
  }
  return links;
}

/** 文章关键词匹配（Go filterPostsByKeyword：title+excerpt+slug，多词 AND） */
function filterPostsByKeyword(posts: GhostPost[], keyword: string): GhostPost[] {
  if (keyword === '') return posts;
  const parts = keyword.toLowerCase().split(/\s+/).filter((p) => p !== '');
  const matched: GhostPost[] = [];
  for (const post of posts) {
    const target = `${post.title} ${post.excerpt} ${post.slug}`.toLowerCase();
    if (parts.every((part) => target.includes(part))) matched.push(post);
  }
  return matched;
}

/** updated_at → ISO（Go updatedAtTime：RFC3339Nano / RFC3339 / "2006-01-02 15:04:05"，失败取当前） */
function updatedAtTime(post: GhostPost): string {
  const t = new Date(post.updated_at);
  if (!Number.isNaN(t.getTime())) return t.toISOString();
  const t2 = new Date(post.updated_at.replace(' ', 'T') + 'Z');
  if (!Number.isNaN(t2.getTime())) return t2.toISOString();
  return new Date().toISOString();
}

export const jsnoteclub = definePlugin({
  name: PLUGIN_NAME,
  priority: 2, // Go defaultPriority
  skipServiceFilter: false, // Go NewBaseAsyncPlugin：默认不跳过 Service 层过滤
  async search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]> {
    let searchKeyword = keyword.trim();
    if (searchKeyword === '') throw new Error(`[${PLUGIN_NAME}] 关键词不能为空`);
    const titleEn = ext['title_en'];
    if (typeof titleEn === 'string' && titleEn.trim() !== '') {
      searchKeyword = `${searchKeyword} ${titleEn.trim()}`;
    }

    const allPosts = await getAllPosts();

    const matched = filterPostsByKeyword(allPosts, searchKeyword);
    if (matched.length === 0) throw new Error(`[${PLUGIN_NAME}] 未找到相关资源`);
    const limited = matched.length > MAX_MATCHED_POSTS ? matched.slice(0, MAX_MATCHED_POSTS) : matched;

    // 并发抓详情页（Go semaphore 8 → createLimiter）
    const limit = createLimiter(MAX_DETAIL_WORKERS);
    const groups = await Promise.all(
      limited.map((post) =>
        limit(async (): Promise<SearchResult[]> => {
          const links = await fetchDetailLinks(post.url);
          if (links.length === 0) return [];
          return [
            {
              message_id: '',
              unique_id: `${PLUGIN_NAME}-${post.id}`,
              channel: '', // 插件结果 Channel 必须为空
              datetime: updatedAtTime(post),
              title: post.title.trim(),
              content: post.excerpt.trim(),
              links,
              tags: [post.slug.trim()],
            },
          ];
        }),
      ),
    );
    const results = groups.flat();

    if (results.length === 0) throw new Error(`[${PLUGIN_NAME}] 未能获取到有效网盘链接`);

    return filterResultsByKeyword(results, searchKeyword);
  },
});
