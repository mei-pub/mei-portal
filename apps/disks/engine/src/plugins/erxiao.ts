// 二小影视（Erxiao）插件 —— Go plugin/erxiao/erxiao.go 的复刻
// 双镜像（MacCMS 模板）搜索页 → 详情页抓取网盘链接（支持 12 种链接类型）。
// 说明：Go 的 HTTP 连接池参数、性能统计原子计数器未移植（与搜索语义无关）；
//       detailCache 为 Go 进程级 sync.Map（无 TTL、无淘汰），此处以模块级 Map 等价复刻；
//       Go 的 extractPassword 方法为死代码（未被调用），未移植。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'erxiao';

const SOURCE_URLS = ['https://www.wexwp.cc', 'https://www.2xiaopan.top'];

// 超时（Go DefaultTimeout / DetailTimeout）
const DEFAULT_TIMEOUT = 8_000;
const DETAIL_TIMEOUT = 6_000;

// 并发控制（Go MaxConcurrency 信号量 → createLimiter）
const MAX_CONCURRENCY = 20;

// 请求头（与 Go 逐条对齐）
const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
};

// 详情页ID提取（Go detailIDRegex）
const DETAIL_ID_REGEX = /\/id\/(\d+)/;

// 常见网盘链接正则（Go 原样搬运，判定顺序与 Go determineLinkType 的 switch 一致）
const LINK_REGEXES: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/, type: 'quark' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/, type: 'uc' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'baidu' },
  { re: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/, type: 'aliyun' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'xunlei' },
  { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/, type: 'tianyi' },
  { re: /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/, type: '115' },
  { re: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/, type: 'mobile' },
  { re: /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/, type: '123' },
  { re: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/, type: 'pikpak' },
  { re: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/, type: 'magnet' },
  { re: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//, type: 'ed2k' },
];

// 详情页缓存（Go detailCache：模块级、无 TTL）
const detailCache = new Map<string, SearchResult>();

/** 校验是否为有效网盘URL（Go isValidNetworkDriveURL） */
function isValidNetworkDriveURL(url: string): boolean {
  if (
    url.includes('javascript:') ||
    url.includes('#') ||
    url === '' ||
    (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:'))
  ) {
    return false;
  }
  return true;
}

/** 根据URL确定链接类型（Go determineLinkType） */
function determineLinkType(url: string): string {
  for (const { re, type } of LINK_REGEXES) {
    if (re.test(url)) return type;
  }
  return ''; // 不支持的类型返回空字符串
}

/**
 * 带重试的抓取（Go doRequestWithRetry）：最多 2 次尝试，间隔 100ms（快速重试）；
 * 整个重试过程共享同一个超时（Go 的 ctx 跨克隆请求生效）。
 */
async function requestHTML(url: string, referer: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastErr: unknown = null;
    for (let i = 0; i < 2; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 100)); // 快速重试
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
    throw new Error(`[${PLUGIN_NAME}] 请求失败，重试2次后仍失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 解析单个搜索结果项（Go parseSearchItem） */
function parseSearchItem($: cheerio.CheerioAPI, s: cheerio.Cheerio<cheerio.Element>): SearchResult | null {
  const headerLink = s.find('.video-info-header h3 a').first();
  const detailLink = headerLink.attr('href');
  if (!detailLink) return null;

  const idMatch = detailLink.match(DETAIL_ID_REGEX);
  if (!idMatch) return null;
  const itemID = idMatch[1];

  const title = headerLink.text().trim();
  if (title === '') return null;

  // 分类
  const category = s.find('.video-info-items').first().find('.video-info-item').first().text().trim();

  // 导演 / 主演 / 剧情：按 .video-info-itemtitle 文本过滤对应 .video-info-items
  const pickByItemTitle = (needle: string): string =>
    s
      .find('.video-info-items')
      .filter((_i, el) => $(el).find('.video-info-itemtitle').text().trim().includes(needle))
      .find('.video-info-item')
      .text()
      .trim();
  const director = pickByItemTitle('导演');
  const actor = pickByItemTitle('主演');
  const plot = pickByItemTitle('剧情');

  // 年份（最后一个 .video-info-items 的第一项）
  const year = s.find('.video-info-items').last().find('.video-info-item').first().text().trim();

  // 质量/状态
  const quality = s.find('.video-info-header .video-info-remarks').text().trim();

  // 封面图片
  const picURL = s.find('.module-item-pic > img').attr('data-src') ?? '';

  const contentParts: string[] = [];
  if (quality !== '') contentParts.push(`【${quality}】`);
  if (director !== '') contentParts.push(`导演：${director}`);
  if (actor !== '') contentParts.push(`主演：${actor}`);
  if (year !== '') contentParts.push(`年份：${year}`);
  if (plot !== '') contentParts.push(`剧情：${plot}`);

  const result: SearchResult = {
    message_id: '',
    unique_id: `${PLUGIN_NAME}-${itemID}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime: '', // Go time.Time{} 零值
    title,
    content: contentParts.join('\n'),
    links: [],
  };
  if (year !== '') result.tags = [year];
  if (category !== '') result.tags = [...(result.tags ?? []), category];
  if (picURL !== '') result.images = [picURL];
  return result;
}

/** 单镜像搜索（Go searchAtBase） */
async function searchAtBase(base: string, keyword: string): Promise<SearchResult[]> {
  const trimmed = base.replace(/\/+$/, '');
  const searchURL = `${trimmed}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;
  const html = await requestHTML(searchURL, `${trimmed}/`, DEFAULT_TIMEOUT);

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
  const posterURL = $('.mobile-play .lazyload').attr('data-src');
  if (posterURL) images.push(posterURL);

  // 下载链接区域：data-clipboard-text
  $('#download-list .module-row-one').each((_i, el) => {
    const linkURL = $(el).find('[data-clipboard-text]').attr('data-clipboard-text');
    if (linkURL && isValidNetworkDriveURL(linkURL)) {
      const linkType = determineLinkType(linkURL);
      if (linkType !== '') links.push({ type: linkType, url: linkURL, password: '' }); // 大部分网盘不需要密码
    }
  });

  return { links, images };
}

/** 异步获取详情页信息（Go enhanceWithDetails；Go 缓存以模块级 Map 复刻） */
async function enhanceWithDetails(results: SearchResult[], baseURL: string): Promise<SearchResult[]> {
  const limit = createLimiter(MAX_CONCURRENCY);
  return Promise.all(
    results.map(async (result) => {
      // 从 UniqueID 提取 itemID（"erxiao-<id>"）
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

export const erxiao = definePlugin({
  name: PLUGIN_NAME,
  priority: 1, // Go NewBaseAsyncPlugin("erxiao", 1)
  skipServiceFilter: false, // Go 默认不跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const { base, results } = await selectSource(keyword);

    // 异步获取详情页信息（补全 links/images）
    const enhanced = await enhanceWithDetails(results, base);

    // 关键词过滤
    return filterResultsByKeyword(enhanced, keyword);
  },
});
