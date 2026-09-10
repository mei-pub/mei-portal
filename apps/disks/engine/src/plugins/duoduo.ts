// Duoduo（多多人影视）网盘搜索插件 —— Go plugin/duoduo 的复刻
// 站点 tv.yydsys.top（苹果 CMS V10）。契约：GET /vod/search/wd/<kw>.html 列表页
// （.module-search-item）→ 并发抓详情页 #download-list 的 data-clipboard-text /
// a[href]，支持 16 种网盘/磁力/ed2k 链接类型。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://tv.yydsys.top';
const SEARCH_URL = 'https://tv.yydsys.top/index.php/vod/search/wd/%s.html';
const DETAIL_URL = 'https://tv.yydsys.top/index.php/vod/detail/id/%s.html';
const DEFAULT_TIMEOUT_MS = 8_000; // Go DefaultTimeout
const DETAIL_TIMEOUT_MS = 6_000; // Go DetailTimeout
const MAX_CONCURRENCY = 20;

// 预编译正则（原样搬运）
const DETAIL_ID_REGEX = /\/vod\/detail\/id\/(\d+)\.html/;

// 16 种链接类型（Go linkXxxRegex）
const LINK_PATTERNS: Array<{ reg: RegExp; typ: string }> = [
  { reg: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/, typ: 'quark' },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/, typ: 'uc' },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, typ: 'baidu' },
  { reg: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/, typ: 'aliyun' },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, typ: 'xunlei' },
  { reg: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/, typ: 'tianyi' },
  { reg: /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/, typ: '115' },
  { reg: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/, typ: 'mobile' },
  { reg: /https?:\/\/share\.weiyun\.com\/[0-9a-zA-Z]+/, typ: 'weiyun' },
  { reg: /https?:\/\/(www\.)?(lanzou[uixys]*|lan[zs]o[ux])\.(com|net|org)\/[0-9a-zA-Z]+/, typ: 'lanzou' },
  { reg: /https?:\/\/(www\.)?jianguoyun\.com\/p\/[0-9a-zA-Z]+/, typ: 'jianguoyun' },
  { reg: /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/, typ: '123' },
  { reg: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/, typ: 'pikpak' },
  { reg: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/, typ: 'magnet' },
  { reg: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//, typ: 'ed2k' },
];

const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  Referer: 'https://tv.yydsys.top/',
};

const DETAIL_HEADERS = { ...SEARCH_HEADERS };
delete (DETAIL_HEADERS as Record<string, string>)['Cache-Control'];

/**
 * 带重试的抓取（Go doRequestWithRetry）：3 次尝试，非 200 也重试，
 * 退避 200ms * 2^(i-1)；整个重试过程共享同一超时（Go 的 ctx 跨克隆请求生效）。
 */
async function fetchWithRetry(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
      try {
        const resp = await fetch(url, { headers, signal: controller.signal });
        if (resp.status === 200) return await resp.text();
        lastErr = new Error(`HTTP状态码: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 校验是否为有效网盘链接（Go isValidNetworkDriveURL） */
function isValidNetworkDriveURL(url: string): boolean {
  if (
    url.includes('javascript:') ||
    url.includes('#') ||
    url === '' ||
    (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:'))
  ) {
    return false;
  }
  return LINK_PATTERNS.some(({ reg }) => reg.test(url));
}

/** 根据URL确定链接类型（Go determineLinkType），不支持返回空串 */
function determineLinkType(url: string): string {
  for (const { reg, typ } of LINK_PATTERNS) {
    if (reg.test(url)) return typ;
  }
  return '';
}

/** 解析单个搜索结果项（Go parseSearchItem） */
function parseSearchItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<never>): SearchResult | null {
  // 详情页链接和ID（从标题链接提取，不是播放链接）
  const titleElement = s.find('.video-info-header h3 a').first();
  const detailLink = titleElement.attr('href');
  if (!detailLink) return null;

  const idMatch = detailLink.match(DETAIL_ID_REGEX);
  if (!idMatch) return null;
  const itemID = idMatch[1];

  const title = titleElement.text().trim();

  // 资源类型/质量
  const quality = s.find('.video-serial').text().trim();

  // 分类信息
  const tags: string[] = [];
  s.find('.video-info-aux .tag-link a').each((_i, tag) => {
    const tagText = $(tag).text().trim();
    if (tagText !== '') tags.push(tagText);
  });

  // 导演信息（最后一个匹配"导演"的条目生效，与 Go 循环一致）
  let director = '';
  s.find('.video-info-items').each((_i, item) => {
    const titleText = $(item).find('.video-info-itemtitle').text().trim();
    if (titleText.includes('导演')) {
      director = $(item).find('.video-info-actor a').text().trim();
    }
  });

  // 主演信息
  const actors: string[] = [];
  s.find('.video-info-items').each((_i, item) => {
    const titleText = $(item).find('.video-info-itemtitle').text().trim();
    if (titleText.includes('主演')) {
      $(item)
        .find('.video-info-actor a')
        .each((_j, actor) => {
          const actorName = $(actor).text().trim();
          if (actorName !== '') actors.push(actorName);
        });
    }
  });

  // 剧情简介
  const plot = s
    .find('.video-info-items')
    .filter((_i, item) => $(item).find('.video-info-itemtitle').text().trim().includes('剧情'))
    .find('.video-info-item')
    .text()
    .trim();

  // 封面图片
  const images: string[] = [];
  const picURL = s.find('.module-item-pic > img').attr('data-src');
  if (picURL && picURL !== '') images.push(picURL);

  // 构建内容描述
  const contentParts: string[] = [];
  if (quality !== '') contentParts.push(`【${quality}】`);
  if (director !== '') contentParts.push(`导演：${director}`);
  if (actors.length > 0) {
    let actorStr = actors.slice(0, 3).join('、'); // 只显示前3个演员
    if (actors.length > 3) actorStr += '等';
    contentParts.push(`主演：${actorStr}`);
  }
  if (plot !== '') contentParts.push(plot);

  return {
    message_id: '',
    unique_id: `duoduo-${itemID}`,
    channel: '', // 插件搜索结果不设置频道名，只有 Telegram 频道结果才设置
    datetime: '', // Go time.Time{} 零值
    title,
    content: contentParts.join('\n'),
    links: [],
    tags,
    images,
  };
}

/** 获取详情页的下载链接和图片（Go fetchDetailLinksAndImages） */
async function fetchDetailLinksAndImages(itemID: string): Promise<{ links: Link[]; images: string[] }> {
  const detailURL = DETAIL_URL.replace('%s', itemID);
  let html: string;
  try {
    html = await fetchWithRetry(detailURL, DETAIL_HEADERS, DETAIL_TIMEOUT_MS);
  } catch {
    return { links: [], images: [] };
  }
  const $ = cheerio.load(html);

  const links: Link[] = [];
  const images: string[] = [];

  // 详情页海报图片
  const posterURL = $('.mobile-play .lazyload').attr('data-src');
  if (posterURL && posterURL !== '') images.push(posterURL);

  // 下载链接区域
  $('#download-list .module-row-one').each((_i, s) => {
    // 从 data-clipboard-text 属性提取链接
    const clipboardURL = $(s).find('[data-clipboard-text]').attr('data-clipboard-text');
    if (clipboardURL && isValidNetworkDriveURL(clipboardURL)) {
      const linkType = determineLinkType(clipboardURL);
      if (linkType !== '') {
        links.push({ type: linkType, url: clipboardURL, password: '' }); // 大部分网盘不需要密码
      }
    }

    // 也检查直接的 href 属性
    $(s)
      .find('a[href]')
      .each((_j, a) => {
        const linkURL = $(a).attr('href');
        if (!linkURL || !isValidNetworkDriveURL(linkURL)) return;
        const linkType = determineLinkType(linkURL);
        if (linkType === '') return;
        // 避免重复添加
        if (links.some((l) => l.url === linkURL)) return;
        links.push({ type: linkType, url: linkURL, password: '' });
      });
  });

  return { links, images };
}

export const duoduo = definePlugin({
  name: 'duoduo',
  priority: 2, // Go NewBaseAsyncPlugin("duoduo", 2)
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 1. 搜索列表页
    const html = await fetchWithRetry(
      SEARCH_URL.replace('%s', encodeURIComponent(keyword)),
      SEARCH_HEADERS,
      DEFAULT_TIMEOUT_MS,
    );
    const $ = cheerio.load(html);

    // 2. 提取搜索结果
    const results: SearchResult[] = [];
    $('.module-search-item').each((_i, s) => {
      const result = parseSearchItem($, $(s));
      if (result) results.push(result);
    });

    // 3. 并发获取详情页信息（Go enhanceWithDetails）
    const limit = createLimiter(MAX_CONCURRENCY);
    const enhancedResults = await Promise.all(
      results.map(async (r) => {
        const parts = r.unique_id.split('-');
        if (parts.length < 2) return r;
        const itemID = parts[1];
        const { links, images } = await limit(() => fetchDetailLinksAndImages(itemID));
        r.links = links;
        // 合并图片：优先使用详情页的海报
        if (images.length > 0) r.images = images;
        return r;
      }),
    );

    // 4. 关键词过滤
    return filterResultsByKeyword(enhancedResults, keyword);
  },
});
