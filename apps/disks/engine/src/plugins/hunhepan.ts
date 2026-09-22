// 混合盘搜索插件 —— Go plugin/hunhepan 的复刻
// 并行请求 4 个聚合 API（hunhepan/qkpanso/kuake8/misoso），每个 API 各抓 3 页，
// 全量合并去重后归一化输出。

import { fetchText } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin } from './shared.ts';

// API 端点（Go 常量逐条对齐）
const HUNHEPAN_API = 'https://hunhepan.com/open/search/disk';
const QKPANSO_API = 'https://qkpanso.com/v1/search/disk';
const KUAKE_API = 'https://kuake8.com/v1/search/disk';
const MISOSO_API = 'https://www.misoso.cc/v1/search/disk';

// 默认页大小
const DEFAULT_PAGE_SIZE = 30;
// 每个 API 最多获取 3 页
const MAX_PAGES = 3;

// HunhepanItem API 响应中的单个结果项（Go json tag 原样）
interface HunhepanItem {
  disk_id: string;
  disk_name: string;
  disk_pass: string;
  disk_type: string;
  files: string;
  doc_id: string;
  share_user: string;
  shared_time: string;
  link: string;
  enabled: boolean;
  weight: number;
  status: number;
}

// HunhepanResponse API 响应结构
interface HunhepanResponse {
  code: number;
  msg: string;
  data: { total: number; per_size: number; list: HunhepanItem[] };
}

/** 按 API 域名设置 Referer / Origin（Go 逐条对齐） */
function headersFor(apiURL: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (apiURL.includes('qkpanso.com')) headers['Referer'] = 'https://qkpanso.com/search';
  else if (apiURL.includes('kuake8.com')) headers['Referer'] = 'https://kuake8.com/search';
  else if (apiURL.includes('hunhepan.com')) headers['Referer'] = 'https://hunhepan.com/search';
  else if (apiURL.includes('misoso.cc')) {
    headers['Referer'] = 'https://www.misoso.cc/search';
    headers['Origin'] = 'https://www.misoso.cc';
  }
  return headers;
}

/** 请求单页：POST JSON（请求体按 Go reqBody 逐字段对齐） */
async function searchPage(apiURL: string, keyword: string, page: number): Promise<HunhepanItem[]> {
  const reqBody = {
    page,
    q: keyword,
    user: '',
    exact: false,
    format: [],
    share_time: '',
    size: DEFAULT_PAGE_SIZE,
    type: '',
    exclude_user: [],
    adv_params: { wechat_pwd: '', platform: 'pc' },
  };

  const body = await fetchText(apiURL, {
    method: 'POST',
    headers: headersFor(apiURL),
    body: JSON.stringify(reqBody),
  });

  const apiResp = JSON.parse(body) as HunhepanResponse;
  if (apiResp.code !== 200) {
    throw new Error(`API returned error (page ${page}): ${apiResp.msg}`);
  }
  return apiResp.data.list ?? [];
}

/** 请求单个 API 的 3 页（页间并发，单页失败不阻断）；全部失败且零结果时抛首个错误 */
async function searchAPI(apiURL: string, apiName: string, keyword: string): Promise<HunhepanItem[]> {
  const settled = await Promise.allSettled(
    Array.from({ length: MAX_PAGES }, (_, i) => searchPage(apiURL, keyword, i + 1)),
  );
  const items: HunhepanItem[] = [];
  const errors: unknown[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') items.push(...s.value);
    else errors.push(s.reason);
  }
  if (items.length === 0 && errors.length > 0) {
    throw new Error(`${apiName} API error: ${errors[0] instanceof Error ? errors[0].message : errors[0]}`);
  }
  return items;
}

/** 去重：优先 DiskID，其次 Link+DiskName，最后 DiskName+DiskType；保留信息更丰富的一项 */
function deduplicateItems(items: HunhepanItem[]): HunhepanItem[] {
  const uniqueMap = new Map<string, HunhepanItem>();
  for (const item of items) {
    // 清理 DiskName 中的 HTML 标签
    const cleanedName = cleanTitle(item.disk_name);
    const entry = { ...item, disk_name: cleanedName };

    let key: string;
    if (entry.disk_id !== '') key = entry.disk_id;
    else if (entry.link !== '') key = `${entry.link}|${cleanedName}`;
    else key = `${cleanedName}|${entry.disk_type}`;

    const existing = uniqueMap.get(key);
    if (!existing) {
      uniqueMap.set(key, entry);
      continue;
    }
    // 比较信息丰富度：文件数 + 密码/时间加成
    let existingScore = existing.files.length;
    let newScore = entry.files.length;
    if (existing.disk_pass === '' && entry.disk_pass !== '') newScore += 5;
    if (existing.shared_time === '' && entry.shared_time !== '') newScore += 3;
    if (newScore > existingScore) uniqueMap.set(key, entry);
  }
  return [...uniqueMap.values()];
}

/** 将 API 网盘类型转换为标准链接类型（Go convertDiskType 逐分支对齐） */
function convertDiskType(diskType: string): string {
  switch (diskType) {
    case 'BDY':
      return 'baidu';
    case 'ALY':
      return 'aliyun';
    case 'QUARK':
      return 'quark';
    case 'TIANYI':
      return 'tianyi';
    case 'UC':
      return 'uc';
    case 'CAIYUN':
      return 'mobile';
    case '115':
      return '115';
    case 'XUNLEI':
      return 'xunlei';
    case '123PAN':
      return '123';
    case 'PIKPAK':
      return 'pikpak';
    default:
      return 'others';
  }
}

/** 清理标题中的 HTML 标签 */
function cleanTitle(title: string): string {
  let result = title;
  for (const tag of ['<em>', '</em>', '<b>', '</b>', '<strong>', '</strong>', '<i>', '</i>']) {
    result = result.split(tag).join('');
  }
  return result.trim();
}

/** 转换为标准 SearchResult（Go convertResults） */
function convertResults(items: HunhepanItem[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const [i, item] of items.entries()) {
    // 跳过无效链接的结果
    if (item.link === '') continue;

    const link: Link = {
      url: item.link,
      type: convertDiskType(item.disk_type),
      password: item.disk_pass,
    };

    let uniqueID = `hunhepan-${item.disk_id}`;
    if (item.disk_id === '') {
      // 使用时间戳 + 索引作为后备
      uniqueID = `hunhepan-${Math.floor(Date.now() / 1000)}-${i}`;
    }

    // 解析时间，格式：2025-07-07 13:19:48（Go time.Parse 无时区 → UTC）
    let datetime = '';
    const m = item.shared_time.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      const parsed = new Date(`${item.shared_time.replace(' ', 'T')}Z`);
      if (!Number.isNaN(parsed.getTime())) datetime = parsed.toISOString();
    }

    results.push({
      message_id: '',
      unique_id: uniqueID,
      channel: '', // 插件搜索结果必须为空字符串
      datetime,
      title: cleanTitle(item.disk_name),
      content: item.files,
      links: [link],
    });
  }
  return results;
}

export const hunhepan = definePlugin({
  name: 'hunhepan',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 4 个 API 并行请求（Go 为 4 goroutine，各内含 3 页并发）
    const settled = await Promise.allSettled([
      searchAPI(HUNHEPAN_API, 'hunhepan', keyword),
      searchAPI(QKPANSO_API, 'qkpanso', keyword),
      searchAPI(KUAKE_API, 'kuake', keyword),
      searchAPI(MISOSO_API, 'misoso', keyword),
    ]);

    const allItems: HunhepanItem[] = [];
    const errors: unknown[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') allItems.push(...s.value);
      else errors.push(s.reason);
    }

    // 没有任何结果且有错误时，返回第一个错误
    if (allItems.length === 0 && errors.length > 0) {
      throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
    }

    const uniqueItems = deduplicateItems(allItems);
    return convertResults(uniqueItems);
  },
});
