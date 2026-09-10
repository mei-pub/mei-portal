// 电影港（DYGANG）磁力搜索插件 —— Go plugin/dygang/dygang.go 的复刻
// 站点 www.dygang.tv，帝国 CMS，GB18030 编码：POST 搜索表单（keyword GB18030 编码）
// → 列表 a.classlinkclass（无则 a[href]）→ 详情页提取磁力链接、简介与剧照。

import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { createLimiter } from '../http.ts';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'dygang';
const BASE_URL = 'https://www.dygang.tv';
const SEARCH_PATH = '/e/search/index.php';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 50;
const MAX_CONCURRENCY = 8;

const DETAIL_ID_RE = /\/([0-9]+)\.(htm|html)$/;
const DATE_RE = /20[0-9]{2}[-/]([0-9]{1,2})[-/]([0-9]{1,2})/;
const BTIH_RE = /btih:([a-z0-9]+)/i;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

type Doc = ReturnType<typeof cheerio.load>;
/** 选择器类型：CheerioAPI 的返回值 */
type Sel = ReturnType<Doc>;

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
  datetime: string;
}

interface MagnetItem {
  url: string;
  subtitle: string;
}

interface DetailResult {
  magnets: MagnetItem[];
  content: string;
  imageURL: string;
}

/** Go url.QueryEscape 作用于 GB18030 字节串的等价：按字节百分号编码（大写十六进制、空格 → '+'） */
function queryEscapeBytes(bytes: Buffer): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0x20) {
      out += '+';
    } else if (
      (b >= 0x30 && b <= 0x39) || // 0-9
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      b === 0x2d || // -
      b === 0x5f || // _
      b === 0x2e || // .
      b === 0x7e // ~
    ) {
      out += String.fromCharCode(b);
    } else {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

/** Go fnv32：按 UTF-8 字节 FNV-1a，返回 %x 小写十六进制 */
function fnv32hex(value: string): string {
  let hash = 2166136261;
  for (const b of Buffer.from(value, 'utf-8')) {
    hash = (hash ^ b) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

/** 从磁力链接提取 btih 哈希（小写），无则返回空串 */
function magnetHash(raw: string): string {
  const m = BTIH_RE.exec(raw);
  return m ? m[1].toLowerCase() : '';
}

function absoluteURL(raw: string): string {
  const v = raw.trim();
  if (v === '' || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('magnet:')) return v;
  if (v.startsWith('//')) return 'https:' + v;
  return BASE_URL + '/' + v.replace(/^\//, '');
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 从列表项文本解析日期（本地时间，失败取当前时间，对应 Go time.ParseInLocation） */
function parseDateText(text: string): string {
  const m = DATE_RE.exec(text);
  if (m) {
    const [y, mo, d] = m[0].replace(/\//g, '-').split('-').map(Number);
    const parsed = new Date(y, mo - 1, d);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/** 提交搜索表单并返回解析后的文档 */
async function fetchSearchDoc(keyword: string): Promise<Doc> {
  const encoded = iconv.encode(keyword, 'gb18030');
  const form = 'tempid=1&tbname=article&keyboard=' + queryEscapeBytes(encoded) + '&show=title%2Csmalltext&Submit=';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(BASE_URL + SEARCH_PATH, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        Referer: BASE_URL + '/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form, // 全 ASCII（GB 字节已百分号编码），可作 UTF-8 字符串发送
      signal: controller.signal,
      redirect: 'follow',
    });
    if (resp.status !== 200) throw new Error(`[${PLUGIN_NAME}] 搜索请求返回 HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer()).subarray(0, 4 << 20); // LimitReader 4MB
    return cheerio.load(iconv.decode(buf, 'gb18030'));
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取详情页：磁力链接 + 简介 + 剧照（错误吞掉，返回空 magnets 即放弃该条） */
async function fetchDetail(detailURL: string): Promise<DetailResult> {
  const empty: DetailResult = { magnets: [], content: '', imageURL: '' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let buf: Buffer;
    try {
      const resp = await fetch(detailURL, {
        headers: { ...BROWSER_HEADERS, Referer: BASE_URL + '/' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (resp.status !== 200) return empty;
      buf = Buffer.from(await resp.arrayBuffer()).subarray(0, 6 << 20); // LimitReader 6MB
    } finally {
      clearTimeout(timer);
    }
    const $ = cheerio.load(iconv.decode(buf, 'gb18030'));

    const magnets = extractMagnets($);

    let contentNode = $('#dede_content').first();
    if (contentNode.length === 0) contentNode = $('body').first();
    let content = cleanText(contentNode.text());
    if (content.length > 500) content = content.slice(0, 500) + '...';

    return { magnets, content, imageURL: firstContentImage($) };
  } catch {
    return empty;
  }
}

/** 解析列表项：先 a.classlinkclass，无则回退全量 a[href]；日期取上二级节点文本 */
function parseSearchItems($: Doc): SearchItem[] {
  const items: SearchItem[] = [];
  const seen = new Set<string>();

  const add = (anchorSelection: Sel, dateSourceText: string) => {
    if (anchorSelection.length === 0) return;
    const href = absoluteURL(anchorSelection.attr('href') ?? '');
    if (!DETAIL_ID_RE.test(href)) return;
    if (seen.has(href)) return;
    const title = cleanText(anchorSelection.text());
    if (title === '') return;
    const id = DETAIL_ID_RE.exec(href)?.[1] ?? '';
    seen.add(href);
    items.push({ id, title, detailURL: href, datetime: parseDateText(dateSourceText) });
  };

  $('a.classlinkclass').each((_i, a) => {
    const anchor = $(a);
    add(anchor, anchor.parent().parent().text());
  });
  if (items.length === 0) {
    $('a[href]').each((_i, a) => {
      const anchor = $(a);
      add(anchor, anchor.parent().parent().text());
    });
  }
  return items;
}

/** 提取页面全部磁力链接（含锚文本作副标题，缺失时回退 dn 参数） */
function extractMagnets($: Doc): MagnetItem[] {
  const links: MagnetItem[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_i, a) => {
    const href = ($(a).attr('href') ?? '').trim();
    if (!href.toLowerCase().startsWith('magnet:?')) return;
    if (seen.has(href)) return;
    seen.add(href);
    let subtitle = cleanText($(a).text());
    if (subtitle === '') {
      try {
        subtitle = cleanText(new URL(href).searchParams.get('dn') ?? '');
      } catch {
        /* 保留空串 */
      }
    }
    links.push({ url: href, subtitle });
  });
  return links;
}

/** 第一张内容剧照（#dede_content img, td.border1 img, img；跳过 logo） */
function firstContentImage($: Doc): string {
  let imageURL = '';
  $('#dede_content img, td.border1 img, img').each((_i, img) => {
    const src = absoluteURL($(img).attr('src') ?? '');
    if (src === '' || src.toLowerCase().includes('logo')) return true; // continue（Go EachWithBreak）
    imageURL = src;
    return false; // break
  });
  return imageURL;
}

export const dygang = definePlugin({
  name: PLUGIN_NAME,
  priority: 3, // Go NewBaseAsyncPluginWithFilter("dygang", 3, true)
  skipServiceFilter: true, // 磁力源：跳过 Service 层过滤，插件内部按关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    const $doc = await fetchSearchDoc(kw);
    const items = parseSearchItems($doc);
    if (items.length === 0) return [];
    if (items.length > MAX_RESULTS) items.length = MAX_RESULTS;

    // 并发抓详情页（Go semaphore 8 → createLimiter(8)）
    const limit = createLimiter(MAX_CONCURRENCY);
    const groups = await Promise.all(
      items.map((item) =>
        limit(async (): Promise<SearchResult[]> => {
          const detail = await fetchDetail(item.detailURL);
          if (detail.magnets.length === 0) return [];

          const results: SearchResult[] = [];
          detail.magnets.forEach((magnet, index) => {
            let id = item.id;
            if (id === '') id = fnv32hex(item.detailURL);
            let hash = magnetHash(magnet.url);
            if (hash === '') {
              hash = String(index);
            } else {
              hash = `${hash}-${fnv32hex(magnet.url)}`;
            }
            let title = item.title;
            if (title === '') title = '未知影片';
            if (magnet.subtitle !== '') title += ' - ' + magnet.subtitle;
            const content = detail.content !== '' ? detail.content : '来源：电影港';

            const result: SearchResult = {
              message_id: `${PLUGIN_NAME}-${id}-${hash}`,
              unique_id: `${PLUGIN_NAME}-${id}-${hash}`,
              channel: '', // 插件结果 Channel 必须为空
              datetime: item.datetime,
              title,
              content,
              links: [{ type: 'magnet', url: magnet.url, password: '', work_title: item.title }],
            };
            if (detail.imageURL !== '') result.images = [detail.imageURL];
            results.push(result);
          });
          return results;
        }),
      ),
    );

    return filterResultsByKeyword(groups.flat(), kw);
  },
});
