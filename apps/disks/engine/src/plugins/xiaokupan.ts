// 小kupan 搜索插件 —— Go plugin/xiaokupan 的复刻
// 站点 xiaokupan.com（SolidStart SSR），经 /_serverFn/<hash> 服务函数接口搜索，
// 响应为 Seroval 序列化格式需专用解码；接口标识失效时自动从入口脚本重新发现。

import { createHash } from 'node:crypto';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'xiaokupan';
const BASE_URL = 'https://xiaokupan.com';
const DEFAULT_SERVER_FUNCTION_ID = 'ffb7ba806a267ced7478dc27716e79ea729a98a801af2ac9c3647bdaca91af78';
const REQUEST_TIMEOUT = 30_000;
const MAX_SEARCH_RESPONSE_SIZE = 4 << 20; // 4MB
const MAX_DISCOVERY_BODY_SIZE = 8 << 20; // 8MB

const INDEX_ASSET_PATTERN = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const HASH_PATTERN = /[a-f0-9]{64}/g;

// 模块级共享状态（Go 的 sync.RWMutex 在事件循环下不需要）
let serverFunctionID = DEFAULT_SERVER_FUNCTION_ID;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Seroval 序列化节点（Go serovalNode） */
interface SerovalNode {
  t: number;
  i?: number;
  s?: unknown;
  p?: { k: string[]; v: (SerovalNode | null)[] };
  a?: (SerovalNode | null)[];
}

/** Seroval 解码器：引用表 + 解引用（Go serovalDecoder） */
class SerovalDecoder {
  private references = new Map<number, SerovalNode>();

  constructor(root: SerovalNode) {
    this.collect(root);
  }

  private collect(node: SerovalNode | null | undefined): void {
    if (node == null) return;
    if (node.i !== undefined) this.references.set(node.i, node);
    if (node.p) for (const child of node.p.v) this.collect(child);
    if (node.a) for (const child of node.a) this.collect(child);
  }

  resolve(node: SerovalNode | null | undefined): SerovalNode | null {
    for (let depth = 0; node != null && node.t === 4 && depth < 16; depth++) {
      if (typeof node.s !== 'number') return null;
      node = this.references.get(node.s) ?? null;
    }
    return node ?? null;
  }

  objectValue(node: SerovalNode | null | undefined, key: string): SerovalNode | null {
    node = this.resolve(node);
    if (node == null || !node.p) return null;
    const idx = node.p.k.indexOf(key);
    if (idx < 0 || idx >= node.p.v.length) return null;
    return this.resolve(node.p.v[idx]);
  }

  stringValue(node: SerovalNode | null | undefined): string {
    node = this.resolve(node);
    if (node == null || node.t !== 1 || typeof node.s !== 'string') return '';
    return node.s;
  }

  stringArray(node: SerovalNode | null | undefined): string[] | null {
    node = this.resolve(node);
    if (node == null || node.t !== 9) return null;
    const values: string[] = [];
    for (const child of node.a ?? []) {
      const value = this.stringValue(child).trim();
      if (value !== '') values.push(value);
    }
    return values;
  }
}

/** 带响应大小上限的 GET（Go doLimitedRequest） */
async function doLimitedRequest(url: string, headers: Record<string, string>, limit: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > limit) throw new Error(`响应超过 ${limit} 字节`);
    return buf.toString('utf-8');
  } finally {
    clearTimeout(timer);
  }
}

/** 构造 Seroval 服务函数搜索参数（Go buildSearchPayload） */
function buildSearchPayload(keyword: string): object {
  return {
    t: {
      t: 10,
      i: 0,
      p: {
        k: ['data'],
        v: [
          {
            t: 10,
            i: 1,
            p: { k: ['query'], v: [{ t: 1, s: keyword }] },
            o: 0,
          },
        ],
      },
      o: 0,
    },
    f: 63,
    m: [],
  };
}

function searchHeaders(keyword: string): Record<string, string> {
  const base = BASE_URL;
  return {
    'User-Agent': BROWSER_UA,
    Accept: 'application/x-tss-framed, application/x-ndjson, application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Origin: base,
    Referer: `${base}/s/${encodeURIComponent(keyword)}`,
    'Sec-Fetch-Site': 'same-origin',
    'x-tsr-serverFn': 'true',
  };
}

async function searchWithFunctionID(keyword: string, functionID: string): Promise<SearchResult[]> {
  const payload = JSON.stringify(buildSearchPayload(keyword));
  const endpoint = `${BASE_URL}/_serverFn/${functionID}?payload=${encodeURIComponent(payload)}`;
  const body = await doLimitedRequest(endpoint, searchHeaders(keyword), MAX_SEARCH_RESPONSE_SIZE);
  return parseSearchResponse(body);
}

/** 从首页入口脚本重新发现服务函数标识（Go discoverServerFunctionID） */
async function discoverServerFunctionID(): Promise<string> {
  const homeURL = `${BASE_URL}/`;
  const homeBody = await doLimitedRequest(
    homeURL,
    { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    MAX_DISCOVERY_BODY_SIZE,
  );

  const assetPath = homeBody.match(INDEX_ASSET_PATTERN)?.[0] ?? '';
  if (assetPath === '') throw new Error('首页未找到入口脚本');
  const assetBody = await doLimitedRequest(
    BASE_URL + assetPath,
    { 'User-Agent': BROWSER_UA, Referer: homeURL },
    MAX_DISCOVERY_BODY_SIZE,
  );

  const routeIndex = assetBody.indexOf('/s/$query');
  if (routeIndex < 0) throw new Error('入口脚本未找到搜索路由');
  const windowStart = Math.max(0, routeIndex - 2048);
  const hashes = assetBody.slice(windowStart, routeIndex).match(HASH_PATTERN) ?? [];
  if (hashes.length === 0) throw new Error('入口脚本未找到搜索接口标识');
  return hashes[hashes.length - 1];
}

/** 刷新服务函数标识（已由并发流程刷新过则直接复用） */
async function refreshServerFunctionID(staleID: string): Promise<string> {
  if (serverFunctionID !== '' && serverFunctionID !== staleID) return serverFunctionID;
  const discoveredID = await discoverServerFunctionID();
  serverFunctionID = discoveredID;
  return discoveredID;
}

function validResourceURL(rawURL: string, linkType: string): boolean {
  const lower = rawURL.toLowerCase();
  if (linkType === 'magnet') return lower.startsWith('magnet:?');
  if (linkType === 'ed2k') return lower.startsWith('ed2k://');
  try {
    const parsed = new URL(rawURL);
    return parsed.host !== '' && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

function parseRFC3339(value: string): string {
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/** 压缩空白并去掉「投稿链接：/链接：」等尾部前缀（Go cleanText） */
function cleanText(value: string): string {
  value = value.trim().replace(/\s+/g, ' ');
  for (const suffix of ['投稿链接:', '投稿链接：', '链接:', '链接：']) {
    if (value.endsWith(suffix)) value = value.slice(0, -suffix.length).trim();
  }
  return value;
}

function parseSearchResponse(body: string): SearchResult[] {
  let root: SerovalNode;
  try {
    root = JSON.parse(body) as SerovalNode;
  } catch (err) {
    throw new Error(`解析 Seroval 响应失败: ${err instanceof Error ? err.message : err}`);
  }
  const decoder = new SerovalDecoder(root);
  const resultNode = decoder.objectValue(root, 'result');
  const searchResultsNode = decoder.objectValue(resultNode, 'searchResults');
  const mergedNode = decoder.resolve(decoder.objectValue(searchResultsNode, 'merged_by_type'));
  if (mergedNode == null || !mergedNode.p) throw new Error('响应缺少 merged_by_type');

  const results: SearchResult[] = [];
  const seenURLs = new Set<string>();
  const keys = mergedNode.p.k;
  const values = mergedNode.p.v;
  for (let index = 0; index < keys.length; index++) {
    if (index >= values.length) break;
    const linkType = keys[index];
    const arrayNode = decoder.resolve(values[index]);
    if (arrayNode == null || arrayNode.t !== 9) continue;

    for (const itemNode of arrayNode.a ?? []) {
      const resourceURL = decoder.stringValue(decoder.objectValue(itemNode, 'url')).trim();
      if (!validResourceURL(resourceURL, linkType)) continue;
      if (seenURLs.has(resourceURL)) continue;

      const note = cleanText(decoder.stringValue(decoder.objectValue(itemNode, 'note')));
      if (note === '') continue;

      const password = decoder.stringValue(decoder.objectValue(itemNode, 'password')).trim();
      const source = cleanText(decoder.stringValue(decoder.objectValue(itemNode, 'source')));
      const datetime = parseRFC3339(decoder.stringValue(decoder.objectValue(itemNode, 'datetime')));
      const images = decoder.stringArray(decoder.objectValue(itemNode, 'images'));
      const uniqueID = `${PLUGIN_NAME}-${createHash('sha256').update(resourceURL).digest('hex')}`;
      const tags = source !== '' ? [linkType, source] : [linkType];

      results.push({
        message_id: uniqueID,
        unique_id: uniqueID,
        channel: '', // 插件结果 Channel 必须为空
        datetime,
        title: note,
        content: note,
        links: [
          {
            type: linkType,
            url: resourceURL,
            password,
            datetime,
            work_title: note,
          } satisfies Link,
        ],
        tags,
        images: images ?? undefined,
      });
      seenURLs.add(resourceURL);
    }
  }
  return results;
}

export const xiaokupan = definePlugin({
  name: PLUGIN_NAME,
  priority: 2,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = cleanText(keyword);
    if (kw === '') return [];

    let functionID = serverFunctionID;
    let results: SearchResult[];
    try {
      results = await searchWithFunctionID(kw, functionID);
    } catch (err) {
      let refreshedID: string;
      try {
        refreshedID = await refreshServerFunctionID(functionID);
      } catch (refreshErr) {
        const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
        throw new Error(`[xiaokupan] 搜索失败: ${msg(err)}；刷新接口标识失败: ${msg(refreshErr)}`);
      }
      results = await searchWithFunctionID(kw, refreshedID);
    }
    return filterResultsByKeyword(results, kw);
  },
});
