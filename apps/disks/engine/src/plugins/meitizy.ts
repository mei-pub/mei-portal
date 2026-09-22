// 美体资源搜索插件 —— Go plugin/meitizy 的复刻
// 2026 迁移后前端与 API 分域：API apis.451024.xyz，前端 video.451024.xyz。
// 契约：POST /api/media/search（{title, page, size:10}，新版 API 仅接受网页用的 size=10），
// 响应 {data:[...]}，link_type 未识别时按 URL 兜底判定网盘类型。

import { fetchProbe } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://apis.451024.xyz';
const FRONTEND_URL = 'https://video.451024.xyz';
const SEARCH_PATH = '/api/media/search';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT = 30_000;
const MAX_PAGE_SIZE = 10; // 新版 API 仅接受网页使用的 size=10
const MAX_RETRIES = 3;

/** API 返回的单个结果项（Go apiItem） */
interface ApiItem {
  id: number;
  title: string;
  content: string;
  link: string;
  link_type: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface SearchResponse {
  data: ApiItem[];
  total: number;
}

/** URL 查询参数提取密码：pwd/password/passcode/code（Go passwordFromURL） */
function passwordFromURL(linkURL: URL): string {
  for (const key of ['pwd', 'password', 'passcode', 'code']) {
    const value = (linkURL.searchParams.get(key) ?? '').trim();
    if (value !== '') return value;
  }
  return '';
}

/** API link_type → 系统网盘类型（Go mapLinkType） */
function mapLinkType(apiLinkType: string): string {
  switch (apiLinkType.toLowerCase()) {
    case 'alipan':
      return 'aliyun';
    case 'xunlei':
      return 'xunlei';
    case 'baidu':
      return 'baidu';
    case 'quark':
      return 'quark';
    case 'uc':
      return 'uc';
    case '115':
      return '115';
    case '123':
      return '123';
    case 'tianyi':
      return 'tianyi';
    case 'mobile':
      return 'mobile';
    case 'pikpak':
      return 'pikpak';
    default:
      // 无法识别返回 others，后续会从 URL 中判断
      return 'others';
  }
}

/** URL 自动识别网盘类型（备选方案，Go determineCloudTypeFromURL） */
function determineCloudTypeFromURL(url: string): string {
  if (url.includes('pan.quark.cn')) return 'quark';
  if (url.includes('drive.uc.cn')) return 'uc';
  if (url.includes('pan.baidu.com')) return 'baidu';
  if (url.includes('aliyundrive.com') || url.includes('alipan.com') || url.includes('www.alipan.com')) return 'aliyun';
  if (url.includes('pan.xunlei.com')) return 'xunlei';
  if (url.includes('cloud.189.cn')) return 'tianyi';
  if (url.includes('caiyun.139.com')) return 'mobile';
  if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115';
  if (
    url.includes('123684.com') ||
    url.includes('123685.com') ||
    url.includes('123912.com') ||
    url.includes('123pan.com') ||
    url.includes('123pan.cn') ||
    url.includes('123592.com')
  ) {
    return '123';
  }
  if (url.includes('mypikpak.com')) return 'pikpak';
  if (url.includes('magnet:')) return 'magnet';
  if (url.includes('ed2k://')) return 'ed2k';
  return 'others';
}

/** 多格式时间解析（Go parseTime：RFC3339 / 毫秒 Z / 秒 Z / 空格分隔 / 纯日期），失败返回零值空串 */
function parseTime(timeStr: string): string {
  if (timeStr === '') return ''; // Go time.Time{} 零值
  // "2006-01-02 15:04:05" → ISO 形式后交给 Date
  const normalized = timeStr.includes(' ') && !timeStr.includes('T') ? timeStr.replace(' ', 'T') : timeStr;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** API 响应 → 标准 SearchResult（Go convertToSearchResults） */
function convertToSearchResults(items: ApiItem[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of items) {
    // 跳过空链接或格式非法的链接（Go：scheme/host 校验，magnet 等无 host 链接同样被拒）
    const linkURL = item.link.trim();
    if (linkURL === '') continue;
    let parsedURL: URL;
    try {
      parsedURL = new URL(linkURL);
    } catch {
      continue;
    }
    if (parsedURL.protocol === '' || parsedURL.host === '') continue;

    // 发布时间：created_at 优先，其次 updated_at，最后取当前
    let publishTime = parseTime(item.created_at);
    if (publishTime === '') publishTime = parseTime(item.updated_at);
    if (publishTime === '') publishTime = new Date().toISOString();

    // 网盘类型：link_type 优先，无法识别从 URL 兜底
    let linkType = mapLinkType(item.link_type);
    if (linkType === 'others') linkType = determineCloudTypeFromURL(linkURL);

    const links: Link[] = [{ type: linkType, url: linkURL, password: passwordFromURL(parsedURL) }];
    const tags = item.tags !== '' ? [item.tags] : undefined;

    results.push({
      message_id: '',
      unique_id: `meitizy-${item.id}`,
      channel: '', // 插件搜索结果必须为空字符串
      datetime: publishTime,
      title: item.title,
      content: item.content,
      links,
      tags,
    });
  }
  return results;
}

/** 带重试的 POST：仅 200 视为成功，退避 200ms * 2^(i-1)（Go doRequestWithRetry） */
async function postWithRetry(url: string, body: string): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (i - 1)));
    try {
      const { status, body: respBody } = await fetchProbe(url, {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Connection: 'keep-alive',
          Origin: FRONTEND_URL,
          Referer: `${FRONTEND_URL}/`,
        },
        body,
      });
      if (status === 200) return respBody;
      lastErr = new Error(`unexpected HTTP status: ${status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`[meitizy] 重试 ${MAX_RETRIES} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

export const meitizy = definePlugin({
  name: 'meitizy',
  priority: 2, // 质量良好，优先级 2
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const respBody = await postWithRetry(
      BASE_URL + SEARCH_PATH,
      JSON.stringify({ title: keyword, page: 1, size: MAX_PAGE_SIZE }),
    );

    const apiResp = JSON.parse(respBody) as SearchResponse;
    const results = convertToSearchResults(apiResp.data ?? []);

    // 关键词过滤（标准网盘插件需要过滤）
    return filterResultsByKeyword(results, keyword);
  },
});
