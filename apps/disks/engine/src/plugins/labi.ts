// 拉比影视（Labi）插件 —— Go plugin/labi/labi.go 的复刻
// 三镜像（MacCMS 模板）搜索页 → 详情页抓取夸克网盘链接（本源只收 quark）。
// 说明：Go 的 HTTP 连接池参数、性能统计原子计数器未移植（与搜索语义无关）；
//       detailCache 在 Go 中为 30 分钟整表清空（清理协程），此处以模块级 Map 等价复刻（无淘汰）；
//       Go 的 fetchDetailLinks 兼容方法（单参数版本）未被调用，未移植。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'labi';

const SOURCE_URLS = ['http://www.xiaocgege.shop', 'http://feimo.fun', 'http://xiaocgege.shop'];

// 超时（Go DefaultTimeout / DetailTimeout）
const DEFAULT_TIMEOUT = 8_000;
const DETAIL_TIMEOUT = 6_000;

// 并发控制（Go MaxConcurrency 信号量 → createLimiter）
const MAX_CONCURRENCY = 20;

// 请求头（与 Go 逐条对齐：含反爬虫规避头）
const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

const DETAIL_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

// 详情页ID提取（Go detailIDRegex）
const DETAIL_ID_REGEX = /\/vod\/detail\/id\/(\d+)\.html/;

// 夸克网盘链接正则（Go quarkLinkRegex）
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/;

// 详情页缓存（Go detailCache：模块级 Map；30 分钟整表清空协程未移植）
const detailCache = new Map<string, SearchResult>();

/** 校验是否为有效网盘URL（Go isValidNetworkDriveURL：本源只认夸克） */
function isValidNetworkDriveURL(url: string): boolean {
  if (url.includes('javascript:') || url.includes('#') || url === '' || !url.startsWith('http')) return false;
  return QUARK_LINK_REGEX.test(url);
}

/**
 * 带重试的抓取（Go doRequestWithRetry）：共 3 次尝试，退避 200ms * 2^(i-1)（尝试前等待）；
 * 整个重试过程共享同一个超时（Go 的 ctx 跨克隆请求生效）。
 */
async function requestHTML(
  url: string,
  referer: string,
  timeoutMs: number,
  headers: Record<string, string> = DETAIL_HEADERS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1))); // 指数退避
      try {
        const resp = await fetch(url, {
          headers: { ...headers, Referer: referer },
          signal: controller.signal,
          redirect: 'follow',
        });
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

/** 解析单个搜索结果项（Go parseSearchItem） */
function parseSearchItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<cheerio.Element>): SearchResult | null {
  // 详情页链接与ID（.module-item-pic a 的 href）
  const detailLink = s.find('.module-item-pic a').first().attr('href');
  if (!detailLink) return null;
  const idMatch = detailLink.match(DETAIL_ID_REGEX);
  if (!idMatch) return null;

  const title = s.find('.video-info-header h3 a').text().trim();
  const quality = s.find('.video-serial').text().trim();

  // 分类标签
  const tags: string[] = [];
  s.find('.video-info-aux .tag-link a').each((_i, tag) => {
    const tagText = $(tag).text().trim();
    if (tagText !== '') tags.push(tagText);
  });

  // 导演 / 主演：按 .video-info-itemtitle 文本匹配对应 .video-info-items
  let director = '';
  const actors: string[] = [];
  s.find('.video-info-items').each((_i, item) => {
    const itemTitle = $(item).find('.video-info-itemtitle').text().trim();
    if (itemTitle.includes('导演')) {
      director = $(item).find('.video-info-actor a').text().trim();
    } else if (itemTitle.includes('主演')) {
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
  const picURL = s.find('.module-item-pic > img').attr('data-src') ?? '';

  const contentParts: string[] = [];
  if (quality !== '') contentParts.push(`【${quality}】`);
  if (director !== '') contentParts.push(`导演：${director}`);
  if (actors.length > 0) {
    let actorStr = actors.slice(0, 3).join('、'); // 只显示前3个演员
    if (actors.length > 3) actorStr += '等';
    contentParts.push(`主演：${actorStr}`);
  }
  if (plot !== '') contentParts.push(plot);

  const result: SearchResult = {
    message_id: '',
    unique_id: `${PLUGIN_NAME}-${idMatch[1]}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime: '', // Go time.Time{} 零值（参考 jikepan 插件标准）
    title,
    content: contentParts.join('\n'),
    links: [],
  };
  if (tags.length > 0) result.tags = tags;
  if (picURL !== '') result.images = [picURL];
  return result;
}

/** 单镜像搜索（Go searchAtBase） */
async function searchAtBase(base: string, keyword: string): Promise<SearchResult[]> {
  const trimmed = base.replace(/\/+$/, '');
  const searchURL = `${trimmed}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;
  const html = await requestHTML(searchURL, `${trimmed}/`, DEFAULT_TIMEOUT, SEARCH_HEADERS);

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
 * 按完成顺序接收；第一个「成功且有结果」的镜像胜出；全部成功但均无结果 → 取首个成功
 * 镜像（结果为空）；全部失败 → 抛最后错误。
 */
function selectSource(keyword: string): Promise<SourceCandidate> {
  return new Promise((resolve, reject) => {
    let remaining = SOURCE_URLS.length;
    let emptyBase = '';
    let lastErr: unknown = null;
    const settle = () => {
      if (remaining > 0) return;
      if (emptyBase !== '') resolve({ base: emptyBase, results: [], err: null });
      else reject(new Error(`[${PLUGIN_NAME}] 搜索请求失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`));
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
  const trimmed = base.replace(/\/+$/, '');
  const detailURL = `${trimmed}/index.php/vod/detail/id/${itemID}.html`;
  let html: string;
  try {
    html = await requestHTML(detailURL, `${trimmed}/`, DETAIL_TIMEOUT);
  } catch {
    return { links: [], images: [] };
  }

  const $ = cheerio.load(html);
  const links: Link[] = [];
  const images: string[] = [];

  // 详情页海报
  const posterURL = $('.module-item-pic > img').attr('data-src');
  if (posterURL) images.push(posterURL);

  // 下载链接区域（本源只收夸克）
  $('#download-list .module-row-one').each((_i, el) => {
    const row = $(el);
    // data-clipboard-text 属性（Go 未对 clipboard 路径去重，保持原样）
    const linkURL = row.find('[data-clipboard-text]').attr('data-clipboard-text');
    if (linkURL && isValidNetworkDriveURL(linkURL)) {
      links.push({ type: 'quark', url: linkURL, password: '' }); // 夸克网盘通常不需要密码
    }

    // 直接的 href 属性（与已收集链接去重）
    row.find('a[href]').each((_j, a) => {
      const hrefURL = $(a).attr('href') ?? '';
      if (!hrefURL || !isValidNetworkDriveURL(hrefURL)) return;
      if (links.some((existing) => existing.url === hrefURL)) return;
      links.push({ type: 'quark', url: hrefURL, password: '' });
    });
  });

  return { links, images };
}

/** 异步获取详情页信息（Go enhanceWithDetails；Go 缓存以模块级 Map 复刻） */
async function enhanceWithDetails(results: SearchResult[], baseURL: string): Promise<SearchResult[]> {
  const limit = createLimiter(MAX_CONCURRENCY);
  return Promise.all(
    results.map(async (result) => {
      // 从 UniqueID 提取 itemID（"labi-<id>"）
      const parts = result.unique_id.split('-');
      if (parts.length < 2) return result;
      const itemID = parts[1];
      const cacheKey = `${baseURL.replace(/\/+$/, '')}|${itemID}`;

      const cached = detailCache.get(cacheKey);
      if (cached) return cached;

      const { links, images } = await fetchDetailLinksAndImages(baseURL, itemID);
      const enhancedResult: SearchResult = {
        ...result,
        links,
        // 合并图片：优先使用详情页的海报，没有则沿用搜索结果的图片
        images: images.length > 0 ? images : result.images,
      };
      detailCache.set(cacheKey, enhancedResult);
      return enhancedResult;
    }),
  );
}

export const labi = definePlugin({
  name: PLUGIN_NAME,
  priority: 1, // Go NewBaseAsyncPlugin("labi", 1)
  skipServiceFilter: false, // Go 默认不跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const { base, results } = await selectSource(keyword);

    // 异步获取详情页信息（补全 links/images）
    const enhanced = await enhanceWithDetails(results, base);

    // 关键词过滤
    return filterResultsByKeyword(enhanced, keyword);
  },
});
