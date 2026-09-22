// 影盘社（Melost）搜索插件 —— Go plugin/melost 的复刻
// 契约：POST https://www.melost.cn/v1/search/disk JSON 接口，并行抓 3 页、
// 每页 size=30，按 disk_id/link 兜底键去重（得分高者胜），标签清洗后输出。

import { fetchProbe } from '../http.ts';
import { getLinkType } from '../regex.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const MELOST_SEARCH_API = 'https://www.melost.cn/v1/search/disk';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_REFERER = 'https://www.melost.cn/search';
const DEFAULT_TIMEOUT = 30_000;

/** 常见 HTML 实体解码（Go html.UnescapeString 的常用子集） */
const HTML_ENTITY_PATTERN = /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  times: '×',
  bull: '•',
};

function unescapeHTML(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (_m, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) || code <= 0 || code > 0x10ffff ? '' : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? '';
  });
}

/** 去实体 + 去 HTML 标签（Go cleanHTML） */
function cleanHTML(value: string): string {
  if (value === '') return '';
  value = unescapeHTML(value);
  value = value.replace(/<[^>]+>/g, '');
  value = value.replaceAll('\r\n', '\n');
  return value.trim();
}

/** 影盘社搜索结果项（Go MelostItem） */
interface MelostItem {
  disk_id: string;
  disk_name: string;
  disk_pass: string;
  disk_type: string;
  files: string;
  doc_id: string;
  share_user: string;
  share_user_id: string;
  shared_time: string;
  rel_movie: string;
  is_mine: boolean;
  tags: unknown;
  link: string;
  enabled: boolean;
  weight: number;
  status: number;
}

interface MelostResponse {
  code: number;
  msg: string;
  data: {
    total: number;
    per_size: number;
    took: number;
    search_result_text: string;
    list: MelostItem[];
  };
}

/** 单页搜索（Go searchPage） */
async function searchPage(keyword: string, pageNum: number): Promise<MelostItem[]> {
  const reqBody = {
    page: pageNum,
    q: keyword,
    user: '',
    exact: false,
    user_distinct: false,
    format: [],
    share_time: '',
    share_year: '',
    size: DEFAULT_PAGE_SIZE,
    order: '',
    type: '',
    search_ticket: '',
    exclude_user: [],
    adv_params: {
      wechat_pwd: '',
      search_code: '',
      platform: 'pc',
      fp_data: '',
      automated: '0',
    },
  };

  const { status, body } = await fetchProbe(MELOST_SEARCH_API, {
    method: 'POST',
    timeoutMs: DEFAULT_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: 'https://www.melost.cn',
      Referer: DEFAULT_REFERER,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(reqBody),
  });
  if (status !== 200) throw new Error(`unexpected status code: ${status}`);

  const apiResp = JSON.parse(body) as MelostResponse;
  if (apiResp.code !== 200) throw new Error(`api returned error: ${apiResp.msg}`);
  return apiResp.data.list ?? [];
}

/** 去重得分：文件数 + 密码/时间/用户/标签加权（Go scoreItem） */
function scoreItem(item: MelostItem): number {
  let score = item.files.length;
  if (item.disk_pass.trim() !== '') score += 5;
  if (item.shared_time.trim() !== '') score += 3;
  if (item.share_user.trim() !== '') score += 2;
  if (item.tags != null) score += 2;
  return score;
}

/** 按 disk_id / link / name+type 兜底键去重，得分高者胜（Go deduplicateItems） */
function deduplicateItems(items: MelostItem[]): MelostItem[] {
  const uniqueMap = new Map<string, MelostItem>();
  for (const item of items) {
    let key = item.disk_id;
    if (key === '') key = item.link;
    if (key === '') key = `${item.disk_name}|${item.disk_type}`;
    const existing = uniqueMap.get(key);
    if (existing === undefined || scoreItem(item) > scoreItem(existing)) {
      uniqueMap.set(key, item);
    }
  }
  return [...uniqueMap.values()];
}

/** API disk_type → 系统网盘类型，未识别则按 URL 兜底（Go convertDiskType） */
function convertDiskType(diskType: string, rawURL: string): string {
  switch (diskType.trim().toUpperCase()) {
    case 'BDY':
    case 'BAIDU':
      return 'baidu';
    case 'ALY':
    case 'ALIYUN':
      return 'aliyun';
    case 'QUARK':
      return 'quark';
    case 'TIANYI':
      return 'tianyi';
    case 'UC':
      return 'uc';
    case 'CAIYUN':
    case 'MOBILE':
      return 'mobile';
    case '115':
      return '115';
    case 'XUNLEI':
      return 'xunlei';
    case '123':
    case '123PAN':
      return '123';
    case 'PIKPAK':
      return 'pikpak';
    case 'LANZOU':
      return 'lanzou';
    default:
      return getLinkType(rawURL.trim());
  }
}

/** tags 字段清洗（Go processTags） */
function processTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const tagStr = tag.trim();
    if (tagStr === '') continue;
    result.push(tagStr);
  }
  return result.length > 0 ? result : undefined;
}

/** "2006-01-02 15:04:05" → ISO；无法解析返回零值空串 */
function parseDatetime(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return ''; // Go time.Time{} 零值
  const parsed = new Date(trimmed.replace(' ', 'T') + 'Z');
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** MelostItem → SearchResult（Go convertResults） */
function convertResults(items: MelostItem[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const [i, item] of items.entries()) {
    if (item.link.trim() === '') continue;

    const linkType = convertDiskType(item.disk_type, item.link);
    const password = item.disk_pass.trim();
    const tags = processTags(item.tags);
    const title = cleanHTML(item.disk_name);

    const contentParts: string[] = [];
    const files = cleanHTML(item.files);
    if (files !== '') contentParts.push(files);
    const shareUser = item.share_user.trim();
    if (shareUser !== '') contentParts.push(`分享用户: ${shareUser}`);
    if (tags && tags.length > 0) contentParts.push(`标签: ${tags.join('、')}`);

    let uniqueID = `melost-${item.disk_id}`;
    if (item.disk_id === '') uniqueID = `melost-${Date.now()}-${i}`;

    results.push({
      message_id: '',
      unique_id: uniqueID,
      channel: '', // 插件结果 Channel 必须为空
      title,
      content: contentParts.join('\n'),
      datetime: parseDatetime(item.shared_time),
      tags,
      links: [{ url: item.link.trim(), type: linkType, password }],
    });
  }
  return results;
}

export const melost = definePlugin({
  name: 'melost',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 并行抓取 3 页（Go goroutine + channel → Promise.allSettled）
    const settled = await Promise.allSettled(
      Array.from({ length: DEFAULT_MAX_PAGES }, (_, idx) => searchPage(keyword, idx + 1)),
    );
    const allItems: MelostItem[] = [];
    const errors: unknown[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') allItems.push(...s.value);
      else errors.push(s.reason);
    }
    if (allItems.length === 0 && errors.length > 0) throw errors[0];

    const uniqueItems = deduplicateItems(allItems);
    const results = convertResults(uniqueItems);
    return filterResultsByKeyword(results, keyword);
  },
});
