// 爱看TV插件 —— Go plugin/ikantv 的代码级移植
// api.naspt.vip 公开搜索 API（JSON），支持 ext.title_en 英文关键词增强。
// 有意简化：Go time.Time 零值（0001-01-01）在此以空字符串表示，与仓库其他插件一致。

import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const SEARCH_API = 'https://api.naspt.vip/api/open/pansou/search';
const DEFAULT_REFERER = 'https://api.naspt.vip/';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_LIMIT = 50;
const MAX_RETRIES = 3;

const ALLOWED_PANS = new Set([
  'quark', 'uc', 'baidu', 'aliyun', 'guangya',
  'xunlei', 'tianyi', '115', '123', 'mobile',
  'pikpak', 'magnet', 'ed2k',
]);

interface ApiLink {
  type?: string;
  url?: string;
  password?: string;
  datetime?: string;
  work_title?: string;
}

interface ApiItem {
  message_id?: string;
  unique_id?: string;
  channel?: string;
  datetime?: string;
  title?: string;
  content?: string;
  tags?: string[];
  images?: string[];
  links?: ApiLink[];
}

interface ApiResponse {
  code: number;
  message: string;
  data?: ApiItem[];
}

/** URL 有效性按类型校验（Go isValidURL） */
function isValidURL(pan: string, raw: string): boolean {
  if (pan === 'magnet') return raw.toLowerCase().startsWith('magnet:?');
  if (pan === 'ed2k') return raw.toLowerCase().startsWith('ed2k://');
  try {
    const u = new URL(raw);
    if (u.host === '') return false;
    return u.protocol.startsWith('http');
  } catch {
    return false;
  }
}

/** RFC3339 解析，失败为零值（Go parseDatetime） */
function parseDatetime(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (v === '') return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function convertLinks(raw: ApiLink[] | undefined): Link[] {
  const links: Link[] = [];
  for (const link of raw ?? []) {
    const pan = (link.type ?? '').trim().toLowerCase();
    if (!ALLOWED_PANS.has(pan)) continue;
    const href = (link.url ?? '').trim();
    if (href === '' || !isValidURL(pan, href)) continue;
    links.push({
      type: pan,
      url: href,
      password: link.password ?? '',
      datetime: parseDatetime(link.datetime),
      work_title: link.work_title ?? '',
    });
  }
  return links;
}

function convertResult(item: ApiItem): SearchResult | null {
  const links = convertLinks(item.links);
  if (links.length === 0) return null;

  let itemID = (item.unique_id ?? '').trim();
  if (itemID === '') itemID = (item.message_id ?? '').trim();
  if (itemID === '') return null;
  if (itemID.startsWith('ikantv-')) itemID = itemID.slice('ikantv-'.length);

  return {
    message_id: item.message_id ?? '',
    unique_id: `ikantv-${itemID}`,
    channel: '', // 插件结果 Channel 必须为空
    datetime: parseDatetime(item.datetime),
    title: item.title ?? '',
    content: item.content ?? '',
    links,
    tags: item.tags,
    images: item.images,
  };
}

/** GET + 重试：网络错误与非 200 均按 200ms*2^(i-1) 退避（Go doRequestWithRetry） */
async function fetchJSON(searchURL: string): Promise<ApiResponse> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    try {
      const resp = await fetch(searchURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Connection: 'keep-alive',
          Referer: DEFAULT_REFERER,
        },
        signal: controller.signal,
      });
      if (resp.status === 200) return (await resp.json()) as ApiResponse;
      lastErr = new Error(`status ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[ikantv] 重试 ${MAX_RETRIES} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

export const ikantv = definePlugin({
  name: 'ikantv',
  priority: 3,
  async search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]> {
    let searchURL = `${SEARCH_API}?kw=${encodeURIComponent(keyword)}&limit=${DEFAULT_LIMIT}`;
    const titleEn = ext['title_en'];
    if (typeof titleEn === 'string' && titleEn !== '') {
      searchURL += `&title_en=${encodeURIComponent(titleEn)}`;
    }

    const apiResp = await fetchJSON(searchURL);
    if (apiResp.code !== 0) throw new Error(`[ikantv] API错误: ${apiResp.message}`);

    const results: SearchResult[] = [];
    for (const item of apiResp.data ?? []) {
      const result = convertResult(item);
      if (result !== null) results.push(result);
    }
    return filterResultsByKeyword(results, keyword);
  },
});
