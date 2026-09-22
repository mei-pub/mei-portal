// 至臻影视插件 —— Go plugin/zhizhen 的代码级移植
// 多镜像（MacCMS 模板）搜索页 → 详情页抓取网盘链接（data-clipboard-text + a[href] 双途径）。
// 说明：Go 版的性能统计原子计数为运维调试代码，未参与搜索语义，未移植；
//       detailCache 为 Go 进程级 sync.Map（cacheTTL 常量未被使用，无淘汰），以模块级 Map 等价复刻。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const SOURCE_URLS = ['http://www.miqk.cc', 'https://mihdr.top', 'https://www.mihdr.top'];

// 超时（Go DefaultTimeout/DetailTimeout）
const DEFAULT_TIMEOUT = 8_000;
const DETAIL_TIMEOUT = 6_000;

// 并发控制（Go MaxConcurrency 信号量 → createLimiter）
const MAX_CONCURRENCY = 20;

// 请求头（与 Go 逐条对齐，含反爬虫头）
const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

// 详情页ID提取（注意与 huban 不同：完整 vod/detail/id 路径）
const DETAIL_ID_REGEX = /\/vod\/detail\/id\/(\d+)\.html/;

// 网盘链接正则（Go 原样搬运；与 huban 的差异——115 仅 115.com、123 仅 123pan.com）
const LINK_REGEXES: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/, type: 'quark' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/, type: 'uc' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'baidu' },
  { re: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/, type: 'aliyun' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'xunlei' },
  { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/, type: 'tianyi' },
  { re: /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/, type: '115' },
  { re: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/, type: 'mobile' },
  { re: /https?:\/\/share\.weiyun\.com\/[0-9a-zA-Z]+/, type: 'weiyun' },
  { re: /https?:\/\/(www\.)?(lanzou[uixys]*|lan[zs]o[ux])\.(com|net|org)\/[0-9a-zA-Z]+/, type: 'lanzou' },
  { re: /https?:\/\/(www\.)?jianguoyun\.com\/p\/[0-9a-zA-Z]+/, type: 'jianguoyun' },
  { re: /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/, type: '123' },
  { re: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/, type: 'pikpak' },
  { re: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/, type: 'magnet' },
  { re: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//, type: 'ed2k' },
];

// 详情页缓存（Go detailCache：模块级、无 TTL）
const detailCache = new Map<string, SearchResult>();

/** 校验是否为有效网盘链接（Go isValidNetworkDriveURL；比 huban 多拒绝 #） */
function isValidNetworkDriveURL(url: string): boolean {
  if (
    url.includes('javascript:') ||
    url.includes('#') ||
    url === '' ||
    (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:'))
  ) {
    return false;
  }
  return LINK_REGEXES.some(({ re }) => re.test(url));
}

/** 根据URL确定链接类型（Go determineLinkType） */
function determineLinkType(url: string): string {
  for (const { re, type } of LINK_REGEXES) {
    if (re.test(url)) return type;
  }
  return ''; // 不支持的类型返回空字符串
}

/**
 * 带重试机制的抓取（Go doRequestWithRetry）：最多 3 次尝试，
 * 指数退避 200ms/400ms；整个重试过程共享同一个超时（Go 的 ctx 跨克隆请求生效）。
 */
async function requestHTML(url: string, referer: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1))); // 指数退避
      try {
        const resp = await fetch(url, {
          headers: { ...SEARCH_HEADERS, Referer: referer },
          signal: controller.signal,
          redirect: 'follow',
        });
        if (resp.status === 200) return await resp.text();
        lastErr = new Error(`HTTP状态码: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`[zhizhen] 重试 3 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 解析单个搜索结果项（Go parseSearchItem） */
function parseSearchItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<any>): SearchResult | null {
  const headerLink = s.find('.video-info-header h3 a').first();
  const detailLink = headerLink.attr('href');
  if (!detailLink) return null;

  const idMatch = detailLink.match(DETAIL_ID_REGEX);
  if (!idMatch) return null;
  const itemID = idMatch[1];
  const uniqueID = `zhizhen-${itemID}`;

  // 标题
  const title = headerLink.text().trim();

  // 资源类型/质量
  const quality = s.find('.video-serial').text().trim();

  // 分类标签
  const tags: string[] = [];
  s.find('.video-info-aux .tag-link a').each((_i, el) => {
    const tagText = $(el).text().trim();
    if (tagText !== '') tags.push(tagText);
  });

  // 导演（.video-info-items 中 itemtitle 含"导演"的条目，Go Each 覆盖赋值 → 最后一个命中生效）
  let director = '';
  s.find('.video-info-items').each((_i, el) => {
    if ($(el).find('.video-info-itemtitle').text().trim().includes('导演')) {
      director = $(el).find('.video-info-actor a').text().trim();
    }
  });

  // 主演（所有"主演"条目下的演员名累计）
  const actors: string[] = [];
  s.find('.video-info-items').each((_i, el) => {
    if ($(el).find('.video-info-itemtitle').text().trim().includes('主演')) {
      $(el)
        .find('.video-info-actor a')
        .each((_j, a) => {
          const actorName = $(a).text().trim();
          if (actorName !== '') actors.push(actorName);
        });
    }
  });

  // 剧情简介
  const plot = s
    .find('.video-info-items')
    .filter((_i, el) => $(el).find('.video-info-itemtitle').text().trim().includes('剧情'))
    .find('.video-info-item')
    .text()
    .trim();

  // 封面图片
  const picURL = s.find('.module-item-pic > img').attr('data-src');
  const images = picURL ? [picURL] : undefined;

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
    unique_id,
    channel: '', // 插件结果 Channel 必须为空
    datetime: '', // Go time.Time{} 零值
    title,
    content: contentParts.join('\n'),
    links: [],
    tags: tags.length > 0 ? tags : undefined,
    images,
  };
}

/** 单镜像搜索（Go searchAtBase） */
async function searchAtBase(base: string, keyword: string): Promise<SearchResult[]> {
  const searchURL = `${base.replace(/\/+$/, '')}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;
  const html = await requestHTML(searchURL, `${base.replace(/\/+$/, '')}/`, DEFAULT_TIMEOUT);

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $('.module-search-item').each((_i, el) => {
    const result = parseSearchItem($, $(el));
    if (result) results.push(result);
  });
  return results;
}

interface SourceCandidate {
  base: string;
  results: SearchResult[];
  err: unknown;
}

/**
 * 并发探测所有镜像并选择数据源（Go searchImpl 的 channel 收集）：
 * 按完成顺序接收；第一个「成功且有结果」的镜像胜出并立即停止等待其余镜像；
 * 全部成功但均无结果 → 取首个成功镜像（结果为空）；全部失败 → 抛最后错误。
 */
function selectSource(keyword: string): Promise<SourceCandidate> {
  return new Promise((resolve, reject) => {
    let remaining = SOURCE_URLS.length;
    let emptyBase = '';
    let lastErr: unknown = null;
    const settle = () => {
      if (remaining > 0) return;
      if (emptyBase !== '') resolve({ base: emptyBase, results: [], err: null });
      else reject(new Error(`[zhizhen] 搜索请求失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`));
    };
    for (const base of SOURCE_URLS) {
      searchAtBase(base, keyword).then(
        (results) => {
          remaining--;
          if (emptyBase === '') emptyBase = base;
          if (results.length > 0) resolve({ base, results, err: null });
          else settle();
        },
        (err) => {
          remaining--;
          lastErr = err;
          settle();
        },
      );
    }
  });
}

/** 获取详情页的下载链接与图片（Go fetchDetailLinksAndImages）；失败静默返回空 */
async function fetchDetailLinksAndImages(base: string, itemID: string): Promise<{ links: Link[]; images: string[] }> {
  const detailURL = `${base.replace(/\/+$/, '')}/index.php/vod/detail/id/${itemID}.html`;
  let html: string;
  try {
    html = await requestHTML(detailURL, `${base.replace(/\/+$/, '')}/`, DETAIL_TIMEOUT);
  } catch {
    return { links: [], images: [] };
  }

  const $ = cheerio.load(html);
  const links: Link[] = [];
  const images: string[] = [];

  // 详情页海报
  const posterURL = $('.mobile-play .lazyload').attr('data-src');
  if (posterURL) images.push(posterURL);

  // 下载链接区域：data-clipboard-text + 直接的 a[href]（后者按 URL 去重）
  $('#download-list .module-row-one').each((_i, el) => {
    const row = $(el);
    const linkURL = row.find('[data-clipboard-text]').attr('data-clipboard-text');
    if (linkURL && isValidNetworkDriveURL(linkURL)) {
      const linkType = determineLinkType(linkURL);
      if (linkType !== '') links.push({ type: linkType, url: linkURL, password: '' }); // 大部分网盘不需要密码
    }

    row.find('a[href]').each((_j, a) => {
      const hrefURL = $(a).attr('href');
      if (!hrefURL || !isValidNetworkDriveURL(hrefURL)) return;
      const linkType = determineLinkType(hrefURL);
      if (linkType === '') return;
      // 避免重复添加
      if (links.some((existing) => existing.url === hrefURL)) return;
      links.push({ type: linkType, url: hrefURL, password: '' });
    });
  });

  return { links, images };
}

/** 异步获取详情页信息（Go enhanceWithDetails；Go 缓存以模块级 Map 复刻） */
async function enhanceWithDetails(results: SearchResult[], baseURL: string): Promise<SearchResult[]> {
  const limit = createLimiter(MAX_CONCURRENCY);
  const enhanced = await Promise.all(
    results.map(async (result) => {
      // 从 UniqueID 提取 itemID（"zhizhen-<id>"）
      const parts = result.unique_id.split('-');
      if (parts.length < 2) return result;
      const itemID = parts[1];
      const cacheKey = `${baseURL.replace(/\/+$/, '')}|${itemID}`;

      const cached = detailCache.get(cacheKey);
      if (cached) return cached;

      const { links, images } = await fetchDetailLinksAndImages(baseURL, itemID);
      const enhancedResult: SearchResult = { ...result, links, images: images.length > 0 ? images : result.images };
      detailCache.set(cacheKey, enhancedResult);
      return enhancedResult;
    }),
  );
  return enhanced;
}

export const zhizhen = definePlugin({
  name: 'zhizhen',
  priority: 1,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const { base, results } = await selectSource(keyword);

    // 异步获取详情页信息（补全 links/images）
    const enhanced = await enhanceWithDetails(results, base);

    // 关键词过滤
    return filterResultsByKeyword(enhanced, keyword);
  },
});
