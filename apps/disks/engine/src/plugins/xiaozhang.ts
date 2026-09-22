// 校长影视（Xiaozhang）插件 —— Go plugin/xiaozhang/xiaozhang.go 的复刻
// 站点 xzys.fun：搜索页 .list-boxes 列表 → 详情页（302 → BaseURL+Location）提取 p>a 网盘链接。
// 说明：Go 的 detailCache（30 分钟整表清空协程）未移植，以模块级 Map 等价复刻（读取时不过期，
//       与搜索语义无关的淘汰逻辑见报告）；Go 的 gzip 手动解压在 Node fetch 下自动完成；
//       debugMode 恒为 false，调试日志未移植。

import * as cheerio from 'cheerio';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'xiaozhang';
const BASE_URL = 'https://xzys.fun';
const SEARCH_PATH = '/search.html';

// 并发控制（Go MaxConcurrency 信号量 → createLimiter）
const MAX_CONCURRENCY = 20;

const REQUEST_TIMEOUT = 20_000; // Go 经 client.Timeout 传入 doRequest（默认插件超时量级）

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

// 请求头（Go setRequestHeaders 逐条对齐；Accept-Encoding 由 Node fetch 托管解压）
const REQUEST_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

// 详情页ID提取（Go 内联 regexp `/subject/(\d+)\.html`）
const DETAIL_ID_REGEX = /\/subject\/(\d+)\.html/;

// 密码提取（Go 内联 regexp，条件：p 文本含「提取码」或「密码」）
const PASSWORD_TEXT_REGEX = /(?:提取码|密码)[：:]?\s*([a-zA-Z0-9]+)/;

// 有效网盘链接域名（Go isValidPanLink）
const PAN_PATTERNS = [
  'pan.baidu.com',
  'pan.quark.cn',
  'www.aliyundrive.com',
  'www.alipan.com',
  '115.com',
  'cloud.189.cn',
  'pan.xunlei.com',
  'www.123pan.com',
  'www.jianguoyun.com',
  'cowtransfer.com',
  'weidian.com',
];

// 链接类型映射（Go determineLinkType 的 map；TS 以插入序遍历）
const LINK_TYPE_MAP: Array<[string, string]> = [
  ['pan.baidu.com', 'baidu'],
  ['pan.quark.cn', 'quark'],
  ['www.aliyundrive.com', 'aliyun'],
  ['www.alipan.com', 'aliyun'],
  ['115.com', '115'],
  ['cloud.189.cn', 'tianyi'],
  ['pan.xunlei.com', 'xunlei'],
  ['www.123pan.com', '123'],
  ['www.jianguoyun.com', 'jianguo'],
  ['cowtransfer.com', 'cowtransfer'],
  ['weidian.com', 'weidian'],
];

// 详情页缓存（Go detailCache：模块级 Map；30 分钟清空协程未移植）
const detailCache = new Map<string, Link[]>();

/** 发送GET请求（Go doRequest；redirect:'manual' 对应 http.ErrUseLastResponse） */
async function doRequest(
  url: string,
  referer: string,
  followRedirect: boolean,
): Promise<{ status: number; location: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, {
      headers: { ...REQUEST_HEADERS, Referer: referer },
      signal: controller.signal,
      redirect: followRedirect ? 'follow' : 'manual',
    });
    return {
      status: resp.status,
      location: resp.headers.get('location') ?? '',
      text: await resp.text(), // Node fetch 自动完成 gzip 解压
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 判断是否是有效的网盘链接（Go isValidPanLink） */
function isValidPanLink(url: string): boolean {
  return PAN_PATTERNS.some((pattern) => url.includes(pattern));
}

/** 判断链接类型（Go determineLinkType） */
function determineLinkType(url: string): string {
  for (const [pattern, linkType] of LINK_TYPE_MAP) {
    if (url.includes(pattern)) return linkType;
  }
  return 'other';
}

/** 从详情页HTML提取下载链接（Go extractDetailPageLinks） */
function extractDetailPageLinks(html: string): Link[] {
  const $ = cheerio.load(html);
  const links: Link[] = [];
  const linkMap = new Set<string>(); // 去重

  $('p').each((_i, p) => {
    const pSel = $(p);
    pSel.find('a[href]').each((_j, a) => {
      const href = $(a).attr('href') ?? '';
      if (href === '') return;
      if (!isValidPanLink(href)) return; // 过滤非网盘链接
      if (linkMap.has(href)) return; // 去重
      linkMap.add(href);

      // 提取密码（可能在 p 标签的文本中）
      let password = '';
      const pText = pSel.text().trim();
      if (pText.includes('提取码') || pText.includes('密码')) {
        password = pText.match(PASSWORD_TEXT_REGEX)?.[1] ?? '';
      }
      // 尝试从URL中提取密码（?pwd=）
      if (password === '' && href.includes('pwd=')) {
        try {
          password = new URL(href).searchParams.get('pwd') ?? '';
        } catch {
          /* 非法 URL 保留空密码 */
        }
      }

      links.push({ url: href, type: determineLinkType(href), password });
    });
  });

  return links;
}

/** 获取详情页的下载链接（Go fetchDetailPageLinks：先取 302 Location，再访问真实详情页） */
async function fetchDetailPageLinks(detailURL: string): Promise<Link[] | null> {
  const cached = detailCache.get(detailURL);
  if (cached) return cached;

  // 第一步：获取重定向位置（不跟随重定向）
  const resp = await doRequest(detailURL, BASE_URL, false);
  if (resp.location === '') {
    // 没有重定向：可能直接就是详情页
    if (resp.status === 200) return extractDetailPageLinks(resp.text);
    return null;
  }

  // 第二步：访问真实的详情页（BaseURL + Location）
  const realDetailURL = BASE_URL + resp.location;
  const resp2 = await doRequest(realDetailURL, detailURL, true);
  if (resp2.status !== 200) return null;

  const links = extractDetailPageLinks(resp2.text);
  detailCache.set(detailURL, links);
  return links;
}

/** 解析时间（格式 2025-08-16；失败/缺失取当前时间，Go time.Parse("2006-01-02")） */
function parsePublishTime(timeText: string): string {
  if (timeText !== '') {
    const parsed = new Date(`${timeText}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

interface ListItem {
  title: string;
  content: string;
  detailURL: string;
  datetime: string;
  resourceID: string;
}

/** 从搜索页HTML提取结果列表（Go extractSearchResults；详情页URL暂存于结构体，不再借用 Tags） */
function extractSearchResults(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];

  $('.list-boxes').each((_i, el) => {
    const s = $(el);
    const titleElem = s.find('a.text_title_p');
    const title = titleElem.text().trim();
    const detailPath = titleElem.attr('href') ?? '';
    if (title === '' || detailPath === '') return;

    const detailURL = BASE_URL + detailPath; // 完整详情页URL
    const content = s.find('p.text_p').text().trim();

    // 发布时间（&nbsp;（含解码后的 U+00A0）→ 空格后清洗）
    const timeText = s
      .find('.list-actions span')
      .first()
      .text()
      .replace(/&nbsp;| /g, ' ')
      .trim();

    // 从详情页路径提取ID（/subject/9861.html → 9861），失败用纳秒时间戳兜底
    let resourceID = detailPath.match(DETAIL_ID_REGEX)?.[1] ?? '';
    if (resourceID === '') resourceID = String(BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n));

    items.push({
      title,
      content,
      detailURL,
      datetime: parsePublishTime(timeText),
      resourceID,
    });
  });

  return items;
}

export const xiaozhang = definePlugin({
  name: PLUGIN_NAME,
  priority: 3, // Go NewBaseAsyncPlugin("xiaozhang", 3)
  skipServiceFilter: false, // Go 默认不跳过 Service 层过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?keyword=${encodeURIComponent(keyword)}`;
    const resp = await doRequest(searchURL, BASE_URL, true);
    if (resp.status !== 200) throw new Error(`[xiaozhang] 搜索响应状态码异常: ${resp.status}`);

    const items = extractSearchResults(resp.text);

    // 并发获取详情页链接（Go semaphore 20 → createLimiter；每项叠加 idx*50ms 错峰延迟）
    const limit = createLimiter(MAX_CONCURRENCY);
    const results = await Promise.all(
      items.map(async (item, idx): Promise<SearchResult> => {
        const links = await limit(async () => {
          await new Promise((r) => setTimeout(r, idx * 50)); // 添加小延迟避免请求过快
          try {
            return (await fetchDetailPageLinks(item.detailURL)) ?? [];
          } catch {
            return []; // Go 中失败仅返回 nil links
          }
        });
        return {
          message_id: `${PLUGIN_NAME}-${item.resourceID}`,
          unique_id: `${PLUGIN_NAME}-${item.resourceID}`,
          channel: '', // 插件结果 Channel 必须为空
          datetime: item.datetime,
          title: item.title,
          content: item.content,
          links, // Tags 中的详情页URL 用后即清（Go 置 nil），此处不再返回
        };
      }),
    );

    // 过滤结果
    return filterResultsByKeyword(results, keyword);
  },
});
