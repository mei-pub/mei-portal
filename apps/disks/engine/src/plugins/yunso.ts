// 小云搜索插件 —— Go plugin/yunso 的复刻
// POST www.yunso.net/api/Core/search2 返回加密 HTML 片段：base64/XOR 解密分享链接，
// 按网盘图标 code 归一化类型，末尾按 Go 逻辑做关键词过滤。

import * as cheerio from 'cheerio';
import { fetchText } from '../http.ts';
import { getLinkType } from '../regex.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const YUNSO_SEARCH_API = 'https://www.yunso.net/api/Core/search2';
const YUNSO_SEARCH_PAGE = 'https://www.yunso.net/index/user/s';
const YUNSO_DECRYPT_KEY = 'pWz1vnL1fTkOvTMW3f9M1jJWfneUIh50';
const YUNSO_DEFAULT_MODE = '90002';
const YUNSO_DEFAULT_SCOPE = '0';
const YUNSO_DEFAULT_PAGE_SIZE = 20;
const YUNSO_DEFAULT_MAX_PAGES = 3;
const YUNSO_DEFAULT_TIMEOUT = 30_000;

const YUNSO_DATETIME_REGEX = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
const YUNSO_TYPE_CODE_REGEX = /\/assets\/xyso\/(\d+)\.png/;

const DECRYPT_KEY_BYTES = Buffer.from(YUNSO_DECRYPT_KEY, 'utf-8');

// YunsoItem 搜索结果项（Go struct 字段一一对应）
interface YunsoItem {
  fullID: string;
  qid: string;
  title: string;
  encryptedURL: string;
  url: string;
  password: string;
  typeCode: string;
  typeName: string;
  preview: string;
  fileSummary: string;
  datetime: string; // '' 表示 Go time.Time{} 零值
  badges: string[];
}

// YunsoAPIResponse 接口响应：data 为加密的 HTML 片段
interface YunsoAPIResponse {
  code: number;
  msg: string;
  data: string;
}

// 常用命名实体（Go html.UnescapeString 为全量 HTML5 表，此处覆盖常用集 + 全量数字实体）
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

/** HTML 实体解码（Go html.UnescapeString 的常用子集） */
function unescapeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const cp = parseInt(body.slice(2), 16);
      return Number.isNaN(cp) ? whole : String.fromCodePoint(cp);
    }
    if (lower.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      return Number.isNaN(cp) ? whole : String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/** 文本清理：实体解码 + 折叠空白（Go cleanYunsoText） */
function cleanText(value: string): string {
  return unescapeEntities(value).replace(/\s+/g, ' ').trim();
}

/** 去重字符串列表（Go uniqueYunsoStrings，空列表返回空） */
function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = cleanText(raw);
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** base64 解码（Go StdEncoding，失败补 = 重试；Node Buffer 宽松，先校验字符集） */
function decodeYunsoBase64(value: string): Buffer | null {
  let v = value.trim();
  if (v === '') return null;
  const pad = v.length % 4;
  if (pad === 3) v += '=';
  else if (pad === 2) v += '==';
  else if (pad === 1) return null; // 非法长度，StdEncoding 会失败
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return null;
  return Buffer.from(v, 'base64');
}

/** 解密分享链接：明文 http 直返；否则 base64 → 明文/异或（Go decryptYunsoURL） */
function decryptYunsoURL(value: string): string {
  const trimmed = unescapeEntities(value).trim();
  if (trimmed === '') return '';
  // 新版响应直接暴露分享 URL，旧结果仍走 base64/XOR 路径
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const decoded = decodeYunsoBase64(trimmed);
  if (!decoded) return '';

  const rawText = decoded.toString('utf-8').trim();
  if (rawText.startsWith('http://') || rawText.startsWith('https://')) return rawText;

  const result = Buffer.alloc(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    result[i] = decoded[i] ^ DECRYPT_KEY_BYTES[i % DECRYPT_KEY_BYTES.length];
  }
  return result.toString('utf-8').trim();
}

/** 提取图标 typeCode（Go extractYunsoTypeCode） */
function extractTypeCode(iconSrc: string): string {
  return iconSrc.match(YUNSO_TYPE_CODE_REGEX)?.[1] ?? '';
}

/** 提取卡片徽标（Go extractYunsoBadges） */
function extractBadges(card: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string[] {
  const badges: string[] = [];
  card.find('.badge').each((_i, badge) => {
    const text = cleanText($(badge).text());
    if (text !== '') badges.push(text);
  });
  return uniqueStrings(badges);
}

/** 从 URL 查询参数提取密码（pwd/pass/password，Go extractYunsoPassword） */
function extractPasswordFromURL(rawURL: string): string {
  if (rawURL === '') return '';
  try {
    const params = new URL(rawURL).searchParams;
    for (const key of ['pwd', 'pass', 'password']) {
      const value = (params.get(key) ?? '').trim();
      if (value !== '') return value;
    }
  } catch {
    /* URL 解析失败视为无密码 */
  }
  return '';
}

/** 解析时间文本（Go parseYunsoDatetime，无时区 → UTC） */
function parseDatetime(text: string): string {
  const match = text.match(YUNSO_DATETIME_REGEX)?.[0];
  if (!match) return '';
  const parsed = new Date(`${match.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** 请求单页并解析卡片（Go searchPage + parseItems） */
async function searchPage(keyword: string, page: number): Promise<YunsoItem[]> {
  // Go url.Values.Encode() 按键名排序输出
  const params: Array<[string, string]> = [
    ['limit', String(YUNSO_DEFAULT_PAGE_SIZE)],
    ['mode', YUNSO_DEFAULT_MODE],
    ['page', String(page)],
    ['requestID', ''],
    ['scope_content', YUNSO_DEFAULT_SCOPE],
    ['screen_filetype', ''],
    ['stype', ''],
    ['uk', ''],
    ['wd', keyword],
  ];
  const searchURL = `${YUNSO_SEARCH_API}?${new URLSearchParams(params).toString()}`;

  const body = await fetchText(searchURL, {
    method: 'POST',
    timeoutMs: YUNSO_DEFAULT_TIMEOUT,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: 'https://www.yunso.net',
      Referer: `${YUNSO_SEARCH_PAGE}?wd=${encodeURIComponent(keyword)}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  const apiResp = JSON.parse(body) as YunsoAPIResponse;
  if (apiResp.code !== 0) throw new Error(`api returned error: ${apiResp.msg}`);

  return parseItems(apiResp.data);
}

function parseItems(fragment: string): YunsoItem[] {
  const $ = cheerio.load(`<div id="yunso-root">${fragment}</div>`);
  const items: YunsoItem[] = [];

  $('div.layui-card[data-qid]').each((_i, cardEl) => {
    const card = $(cardEl);
    const anchor = card.find('a[onclick*="open_sid"]').first();
    if (anchor.length === 0) return;

    const title = cleanText(anchor.text());
    if (title === '') return;

    const encryptedURL = (anchor.attr('url') ?? '').trim();
    const decryptedURL = encryptedURL !== '' ? decryptYunsoURL(encryptedURL) : '';

    let fileSummary = cleanText(card.find('.layui-card-body span').first().text());
    if (fileSummary.toUpperCase().includes('N/A')) fileSummary = '';

    const icon = card.find('img[src*="/assets/xyso/"]').first();

    let password = cleanText(anchor.attr('pa') ?? '');
    const url = decryptedURL.trim();
    if (password === '') password = extractPasswordFromURL(url);

    items.push({
      fullID: (anchor.attr('id') ?? '').trim(),
      qid: (card.attr('data-qid') ?? '').trim(),
      title,
      encryptedURL,
      url,
      password,
      typeCode: extractTypeCode(icon.attr('src') ?? ''),
      typeName: cleanText(icon.attr('alt') ?? ''),
      preview: cleanText(card.find('p.result.container.p').first().text()),
      fileSummary,
      datetime: parseDatetime(card.find('.layui-card-header').text()),
      badges: extractBadges(card, $),
    });
  });

  return items;
}

/** 去重：优先 URL，其次 FullID，最后 QID|Title；保留得分更高的一项 */
function deduplicateItems(items: YunsoItem[]): YunsoItem[] {
  const uniqueMap = new Map<string, YunsoItem>();
  for (const item of items) {
    let key = item.url;
    if (key === '') key = item.fullID;
    if (key === '') key = `${item.qid}|${item.title}`;
    const existing = uniqueMap.get(key);
    if (!existing || scoreItem(item) > scoreItem(existing)) uniqueMap.set(key, item);
  }
  return [...uniqueMap.values()];
}

/** 信息丰富度打分（Go scoreYunsoItem） */
function scoreItem(item: YunsoItem): number {
  let score = 0;
  if (item.url !== '') score += 8;
  if (item.password !== '') score += 5;
  if (item.datetime !== '') score += 3;
  if (item.fileSummary !== '') score += 2;
  if (item.preview !== '') score += 2;
  if (item.typeCode !== '') score++;
  return score;
}

/** 类型归一化（Go mapDiskType：图标 code 优先，URL 兜底走 GetLinkType） */
function mapDiskType(typeCode: string, rawURL: string): string {
  switch (typeCode.trim()) {
    case '1':
      return 'baidu';
    case '20100':
      return 'aliyun';
    case '20500':
      return 'quark';
    case '20000':
      return 'tianyi';
    case '20300':
      return 'mobile';
    case '20400':
      return 'xunlei';
    case '20501':
      return 'uc';
    case '20600':
      return 'lanzou';
  }
  const lowerURL = rawURL.toLowerCase().trim();
  if (lowerURL.includes('fast.uc.cn') || lowerURL.includes('uc.cn')) return 'uc';
  return getLinkType(lowerURL);
}

/** 转换为标准 SearchResult（Go convertResults） */
function convertResults(items: YunsoItem[]): SearchResult[] {
  const results: SearchResult[] = [];
  for (const [i, item] of items.entries()) {
    if (item.url.trim() === '') continue;

    const contentParts: string[] = [];
    if (item.preview !== '') contentParts.push(item.preview);
    if (item.fileSummary !== '') contentParts.push(item.fileSummary);
    if (item.typeName !== '') contentParts.push(`网盘: ${item.typeName}`);

    const tags = uniqueStrings([item.typeName, ...item.badges]);

    let uniqueID = `yunso-${item.fullID}`;
    if (item.fullID === '') uniqueID = `yunso-${item.qid}-${i}`;

    const link: Link = {
      url: item.url,
      type: mapDiskType(item.typeCode, item.url),
      password: item.password,
    };
    if (item.datetime !== '') link.datetime = item.datetime;

    results.push({
      message_id: '',
      unique_id: uniqueID,
      channel: '',
      datetime: item.datetime,
      title: item.title,
      content: contentParts.join('\n'),
      tags: tags.length > 0 ? tags : undefined,
      links: [link],
    });
  }
  return results;
}

export const yunso = definePlugin({
  name: 'yunso',
  priority: 3,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 3 页并发请求（Go goroutine per page）
    const settled = await Promise.allSettled(
      Array.from({ length: YUNSO_DEFAULT_MAX_PAGES }, (_, i) => searchPage(keyword, i + 1)),
    );
    const allItems: YunsoItem[] = [];
    const errs: unknown[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') allItems.push(...s.value);
      else errs.push(s.reason);
    }
    if (allItems.length === 0 && errs.length > 0) {
      throw errs[0] instanceof Error ? errs[0] : new Error(String(errs[0]));
    }

    const uniqueItems = deduplicateItems(allItems);
    const results = convertResults(uniqueItems);
    return filterResultsByKeyword(results, keyword);
  },
});
