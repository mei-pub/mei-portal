// Wanou 插件 —— Go plugin/wanou 的复刻
// 采集 API woog.nxog.eu.org（苹果 CMS vod 接口）：ac=detail 按 vod_down_from/vod_down_url
// 拆分网盘链接，API 标识 + URL 正则双重判定类型，末尾不做关键词过滤（Go 原样）。

import { fetchProbe } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

// 默认超时时间
const DEFAULT_TIMEOUT = 8_000;

// API 搜索地址
const API_URL = 'https://woog.nxog.eu.org/api.php/provide/vod';

// 网盘链接正则（Go 预编译常量原样搬运）
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/;
const UC_LINK_REGEX = /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/;
const BAIDU_LINK_REGEX = /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/;
const ALIYUN_LINK_REGEX = /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/;
const XUNLEI_LINK_REGEX = /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/;
const TIANYI_LINK_REGEX = /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/;
const LINK115_REGEX = /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/;
const MOBILE_LINK_REGEX = /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/;
const LINK123_REGEX = /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/;
const PIKPAK_LINK_REGEX = /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/;
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/;
const ED2K_LINK_REGEX = /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//;

// 密码提取
const PASSWORD_REGEX = /\?pwd=([0-9a-zA-Z]+)/;

// WanouAPIItem API 数据项（Go json tag 原样）
interface WanouAPIItem {
  vod_id: number;
  vod_name: string;
  vod_actor: string;
  vod_director: string;
  vod_down_from: string;
  vod_down_url: string;
  vod_remarks: string;
  vod_pubdate: string;
  vod_area: string;
  vod_year: string;
  vod_content: string;
  vod_pic: string;
}

// WanouAPIResponse API 响应结构
interface WanouAPIResponse {
  code: number;
  msg: string;
  page: number;
  pagecount: number;
  limit: number;
  total: number;
  list: WanouAPIItem[];
}

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  Referer: 'https://woog.nxog.eu.org/',
  'Cache-Control': 'no-cache',
};

/** 带重试的 GET（Go doRequestWithRetry：JSON API 共 2 次尝试，间隔 100ms，需 HTTP 200） */
async function doRequestWithRetry(url: string, retries = 2): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      const { status, body } = await fetchProbe(url, { timeoutMs: DEFAULT_TIMEOUT, headers: REQUEST_HEADERS });
      if (status === 200) return body;
      lastErr = new Error(`HTTP状态码: ${status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 100)); // JSON API 快速重试
  }
  throw new Error(
    `[wanou] 请求失败，重试${retries}次后仍失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
}

/** 链接类型判定（Go determineLinkTypeOptimized：基本验证 → API 标识快速映射 → URL 正则兜底） */
function determineLinkType(apiType: string, url: string): string {
  // 基本验证（原 isValidNetworkDriveURL 逻辑）
  if (
    url.includes('javascript:') ||
    url.includes('#') ||
    url === '' ||
    (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:'))
  ) {
    return '';
  }

  // 优先根据 API 标识快速映射（标识命中还需 URL 正则验证）
  switch (apiType.toUpperCase()) {
    case 'BD':
      if (BAIDU_LINK_REGEX.test(url)) return 'baidu';
      break;
    case 'KG':
      if (QUARK_LINK_REGEX.test(url)) return 'quark';
      break;
    case 'UC':
      if (UC_LINK_REGEX.test(url)) return 'uc';
      break;
    case 'ALY':
      if (ALIYUN_LINK_REGEX.test(url)) return 'aliyun';
      break;
    case 'XL':
      if (XUNLEI_LINK_REGEX.test(url)) return 'xunlei';
      break;
    case 'TY':
      if (TIANYI_LINK_REGEX.test(url)) return 'tianyi';
      break;
    case '115':
      if (LINK115_REGEX.test(url)) return '115';
      break;
    case 'MB':
      if (MOBILE_LINK_REGEX.test(url)) return 'mobile';
      break;
    case '123':
      if (LINK123_REGEX.test(url)) return '123';
      break;
    case 'PIKPAK':
      if (PIKPAK_LINK_REGEX.test(url)) return 'pikpak';
      break;
  }

  // API 标识匹配失败，回退到 URL 正则匹配
  if (BAIDU_LINK_REGEX.test(url)) return 'baidu';
  if (UC_LINK_REGEX.test(url)) return 'uc';
  if (ALIYUN_LINK_REGEX.test(url)) return 'aliyun';
  if (XUNLEI_LINK_REGEX.test(url)) return 'xunlei';
  if (TIANYI_LINK_REGEX.test(url)) return 'tianyi';
  if (LINK115_REGEX.test(url)) return '115';
  if (MOBILE_LINK_REGEX.test(url)) return 'mobile';
  if (LINK123_REGEX.test(url)) return '123';
  if (PIKPAK_LINK_REGEX.test(url)) return 'pikpak';
  if (MAGNET_LINK_REGEX.test(url)) return 'magnet';
  if (ED2K_LINK_REGEX.test(url)) return 'ed2k';
  if (QUARK_LINK_REGEX.test(url)) return 'quark';
  return ''; // 不支持的类型
}

/** 解析下载链接（Go parseDownloadLinks：$$$ 分组对位） */
function parseDownloadLinks(vodDownFrom: string, vodDownURL: string): Link[] {
  if (vodDownFrom === '' || vodDownURL === '') return [];

  const fromParts = vodDownFrom.split('$$$');
  const urlParts = vodDownURL.split('$$$');
  const minLen = Math.min(fromParts.length, urlParts.length);

  const links: Link[] = [];
  for (let i = 0; i < minLen; i++) {
    const urlStr = urlParts[i].trim();
    if (urlStr === '') continue;

    const linkType = determineLinkType(fromParts[i].trim(), urlStr);
    if (linkType === '') continue;

    links.push({
      type: linkType,
      url: urlStr,
      password: urlStr.match(PASSWORD_REGEX)?.[1] ?? '',
    });
  }
  return links;
}

/** 解析 API 数据项（Go parseAPIItem） */
function parseAPIItem(item: WanouAPIItem): SearchResult | null {
  const title = item.vod_name.trim();
  if (title === '') return null;

  const contentParts: string[] = [];
  if (item.vod_actor !== '') contentParts.push(`主演: ${item.vod_actor}`);
  if (item.vod_director !== '') contentParts.push(`导演: ${item.vod_director}`);
  if (item.vod_area !== '') contentParts.push(`地区: ${item.vod_area}`);
  if (item.vod_year !== '') contentParts.push(`年份: ${item.vod_year}`);
  if (item.vod_remarks !== '') contentParts.push(`状态: ${item.vod_remarks}`);

  const tags: string[] = [];
  if (item.vod_year !== '') tags.push(item.vod_year);
  if (item.vod_area !== '') tags.push(item.vod_area);

  return {
    message_id: '',
    unique_id: `wanou-${item.vod_id}`,
    channel: '', // 插件搜索结果 Channel 为空
    datetime: '', // Go time.Time{} 零值
    title,
    content: contentParts.join(' | '),
    links: parseDownloadLinks(item.vod_down_from, item.vod_down_url),
    tags: tags.length > 0 ? tags : undefined,
    images: item.vod_pic !== '' ? [item.vod_pic] : undefined,
  };
}

export const wanou = definePlugin({
  name: 'wanou',
  priority: 1,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${API_URL}?ac=detail&wd=${encodeURIComponent(keyword)}`;

    let body: string;
    try {
      body = await doRequestWithRetry(searchURL);
    } catch (err) {
      throw new Error(`[wanou] 搜索请求失败: ${err instanceof Error ? err.message : err}`);
    }

    let apiResponse: WanouAPIResponse;
    try {
      apiResponse = JSON.parse(body) as WanouAPIResponse;
    } catch (err) {
      throw new Error(`[wanou] 解析JSON响应失败: ${err instanceof Error ? err.message : err}`);
    }

    // 检查 API 响应状态
    if (apiResponse.code !== 1) throw new Error(`[wanou] API返回错误: ${apiResponse.msg}`);

    const results: SearchResult[] = [];
    for (const item of apiResponse.list ?? []) {
      const result = parseAPIItem(item);
      if (result && result.title !== '') results.push(result);
    }
    return results;
  },
});
