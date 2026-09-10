// 海豚搜插件 —— Go plugin/haitunsou 的代码级移植
// 页面内嵌 `const list = JSON.parse('...')` / `let listItems = JSON.parse('...')`，
// 单引号 JS 字符串需手工解转义后 JSON 解析；链接按 host + is_type 双重校验归一化。
// 有意简化：Go 的 time.ParseInLocation(time.Local) 在此处统一按 UTC（T00:00:00Z）解析，
// 与仓库其他插件约定一致；Go 的 3MB 响应上限保留为长度检查。

import { createHash } from 'node:crypto';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'haitunsou';
const BASE_URL = 'https://www.haitunsou.com';
const REQUEST_TIMEOUT = 25_000;
const MAX_RESPONSE_SIZE = 3 * 1024 * 1024;

const LIST_MARKERS = ["const list = JSON.parse('", "let listItems = JSON.parse('"];

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
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  divide: '÷',
};

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

/** 去首尾空白 + 解码实体 + 折叠连续空白（Go cleanText） */
function cleanText(value: string): string {
  return unescapeEntities(value.trim()).split(/\s+/).filter((s) => s !== '').join(' ');
}

interface SearchItem {
  id: number;
  source_category_id: number;
  title: string;
  is_type: number;
  code: string;
  url: string;
  name: string;
  times: string;
  category: unknown;
}

/** 定位内嵌结果并解析（Go parseEmbeddedList） */
function parseEmbeddedList(body: string): SearchItem[] {
  let start = -1;
  for (const marker of LIST_MARKERS) {
    const index = body.indexOf(marker);
    if (index >= 0) {
      start = index + marker.length;
      break;
    }
  }
  if (start < 0) throw new Error('未找到页面内嵌结果');

  const encoded = scanSingleQuotedString(body, start);
  const decoded = decodeJSSingleQuotedString(encoded);
  try {
    return JSON.parse(decoded) as SearchItem[];
  } catch (err) {
    throw new Error(`解析结果 JSON 失败: ${err instanceof Error ? err.message : err}`);
  }
}

/** 扫描到下一个未转义的单引号（Go scanSingleQuotedString） */
function scanSingleQuotedString(body: string, start: number): string {
  let escaped = false;
  for (let index = start; index < body.length; index++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    switch (body[index]) {
      case '\\':
        escaped = true;
        break;
      case "'":
        return body.slice(start, index);
    }
  }
  throw new Error('内嵌结果字符串未闭合');
}

/** 解码 JS 单引号字符串转义（Go decodeJSSingleQuotedString） */
function decodeJSSingleQuotedString(encoded: string): string {
  let decoded = '';
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] !== '\\') {
      decoded += encoded[index];
      continue;
    }
    index++;
    if (index >= encoded.length) throw new Error('字符串以转义符结尾');
    switch (encoded[index]) {
      case '\\':
      case "'":
      case '"':
      case '/':
        decoded += encoded[index];
        break;
      case 'b':
        decoded += '\b';
        break;
      case 'f':
        decoded += '\f';
        break;
      case 'n':
        decoded += '\n';
        break;
      case 'r':
        decoded += '\r';
        break;
      case 't':
        decoded += '\t';
        break;
      case 'v':
        decoded += '\v';
        break;
      case '0':
        decoded += '\0';
        break;
      case '\n':
        break; // JS 行继续符
      case '\r':
        if (index + 1 < encoded.length && encoded[index + 1] === '\n') index++;
        break;
      case 'x': {
        const { value, next } = decodeHexEscape(encoded, index + 1, 2);
        decoded += String.fromCharCode(value);
        index = next - 1;
        break;
      }
      case 'u': {
        const { value, next } = decodeHexEscape(encoded, index + 1, 4);
        let r = value;
        index = next - 1;
        // 代理对合并
        if (r >= 0xd800 && r <= 0xdbff && next + 6 <= encoded.length && encoded[next] === '\\' && encoded[next + 1] === 'u') {
          try {
            const low = decodeHexEscape(encoded, next + 2, 4);
            if (low.value >= 0xdc00 && low.value <= 0xdfff) {
              r = 0x10000 + ((r - 0xd800) << 10) + (low.value - 0xdc00);
              index = low.next - 1;
            }
          } catch {
            /* 低代理非法则保留高代理字符 */
          }
        }
        decoded += String.fromCodePoint(r);
        break;
      }
      default:
        decoded += encoded[index];
    }
  }
  return decoded;
}

function decodeHexEscape(data: string, start: number, length: number): { value: number; next: number } {
  const end = start + length;
  if (start < 0 || end > data.length) throw new Error('转义序列不完整');
  const value = parseInt(data.slice(start, end), 16);
  if (Number.isNaN(value)) throw new Error(`无效十六进制转义: ${data.slice(start, end)}`);
  return { value, next: end };
}

/** 拆分「资源标题：/资源描述：」（Go splitTitleAndDescription） */
function splitTitleAndDescription(value: string): [string, string] {
  value = value.trim();
  for (const prefix of ['资源标题：', '资源标题:']) {
    value = value.slice(value.startsWith(prefix) ? prefix.length : 0).trim();
  }
  for (const marker of ['资源描述：', '资源描述:']) {
    const index = value.indexOf(marker);
    if (index >= 0) {
      return [value.slice(0, index).trim(), value.slice(index + marker.length).trim()];
    }
  }
  return [value, ''];
}

const DECLARED_TYPES: Record<number, string> = { 0: 'quark', 1: 'aliyun', 2: 'baidu', 3: 'uc', 4: 'xunlei' };

/** 归一化链接：host + is_type 双重校验（Go normalizeLink） */
function normalizeLink(rawURL: string, declaredPassword: string, declaredType: number): { type: string; url: string; password: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawURL.trim());
  } catch {
    return null;
  }
  if (parsed.host === '' || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return null;

  const host = parsed.hostname.toLowerCase();
  let linkType = '';
  if (host === 'pan.quark.cn') linkType = 'quark';
  else if (host === 'www.aliyundrive.com' || host === 'aliyundrive.com' || host === 'www.alipan.com' || host === 'alipan.com') linkType = 'aliyun';
  else if (host === 'pan.baidu.com') linkType = 'baidu';
  else if (host === 'drive.uc.cn') linkType = 'uc';
  else if (host === 'pan.xunlei.com') linkType = 'xunlei';
  else return null;

  const expected = DECLARED_TYPES[declaredType];
  if (expected !== undefined && expected !== linkType) return null;

  let password = declaredPassword.trim();
  if (password === '') {
    for (const key of ['pwd', 'password', 'code']) {
      const value = (parsed.searchParams.get(key) ?? '').trim();
      if (value !== '') {
        password = value;
        break;
      }
    }
  }
  return { type: linkType, url: parsed.toString(), password };
}

/** "2006-01-02" → ISO（Go ParseInLocation 在此按 UTC 解析） */
function parseDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function convertItem(item: SearchItem): SearchResult | null {
  let rawTitle = cleanText(item.title ?? '');
  if (rawTitle === '') rawTitle = cleanText(item.name ?? '');
  if (rawTitle === '') return null;
  const [title, description] = splitTitleAndDescription(rawTitle);
  if (title === '') return null;

  const link = normalizeLink(item.url ?? '', item.code ?? '', item.is_type ?? 0); // Go 缺省零值为 0（quark）
  if (link === null) return null;
  const datetime = parseDate(item.times ?? '');

  let content = cleanText(item.name ?? '');
  if (content === '') content = description;
  if (content === '') content = rawTitle;

  const uniqueID =
    item.id > 0
      ? `${PLUGIN_NAME}-${item.id}`
      : `${PLUGIN_NAME}-${createHash('sha256').update(link.url).digest('hex')}`;

  const panLink: Link = {
    type: link.type,
    url: link.url,
    password: link.password,
    datetime,
    work_title: title,
  };
  return {
    message_id: uniqueID,
    unique_id: uniqueID,
    channel: '', // 插件结果 Channel 必须为空
    datetime,
    title,
    content,
    links: [panLink],
    tags: [link.type],
  };
}

export const haitunsou = definePlugin({
  name: PLUGIN_NAME,
  priority: 2,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = cleanText(keyword);
    if (kw === '') return [];

    const searchURL = `${BASE_URL}/s/${encodeURIComponent(kw)}.html`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let body: string;
    try {
      const resp = await fetch(searchURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          Referer: `${BASE_URL}/`,
        },
        signal: controller.signal,
      });
      if (resp.status !== 200) throw new Error(`[haitunsou] 搜索请求返回 HTTP ${resp.status}`);
      body = await resp.text();
    } catch (err) {
      throw new Error(`[haitunsou] 搜索请求失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      clearTimeout(timer);
    }
    if (body.length > MAX_RESPONSE_SIZE) throw new Error(`[haitunsou] 搜索响应超过 ${MAX_RESPONSE_SIZE} 字节`);

    const items = parseEmbeddedList(body);
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const result = convertItem(item);
      if (result === null) continue;
      const key = `${result.links[0].url} ${result.links[0].password}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    }
    return filterResultsByKeyword(results, kw);
  },
});
