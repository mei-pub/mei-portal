// 电影天堂（DYGOD）磁力搜索插件 —— Go plugin/dygod 的复刻
// 站点 www.dygod.vip（备镜像 www.dytt8899.com），帝国 CMS，GB2312 编码。
// 契约：POST /e/search/index.php 表单（keyword 需 GB2312 编码）→ 302 → 结果列表
// a.ulink → 详情页内直接含 magnet/ed2k 链接（每条重复两次需去重）。

import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { createLimiter } from '../http.ts';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const MIRRORS = ['https://www.dygod.vip', 'https://www.dytt8899.com'];
const DETAIL_HREF_REGEX = /^\/html\/[a-z0-9/]+\/(\d+)\.html$/;
const DATE_FROM_HREF_REGEX = /\/html\/[a-z0-9/]+\/(\d{8})\/\d+\.html$/;
const MAGNET_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{32,40}[^"'\s<>]*/g;
const ED2K_REGEX = /ed2k:\/\/\|file\|[^"'\s<>]+/g;
const ALIAS_REGEX = /◎(?:译\s*名|片\s*名)\s*([^/\n]+)/;
const YEAR_REGEX = /◎年\s*代\s*(\d{4})/;

const MAX_DETAIL_ITEMS = 10; // 列表按相关度排序，深列表老资源居多
const DETAIL_CONCURRENCY = 4; // 老站带宽有限，克制
const SEARCH_TIMEOUT = 20_000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 抓取 GB2312 页面并解码为 UTF-8 文本 */
async function fetchGBK(target: string, referer: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const resp = await fetch(target, {
      headers: { ...BROWSER_HEADERS, Referer: referer },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return iconv.decode(buf, 'gbk');
  } finally {
    clearTimeout(timer);
  }
}

interface DetailItem {
  href: string;
  title: string;
  date: string; // YYYYMMDD（来自 URL 路径）
}

async function searchMirror(base: string, keyword: string): Promise<DetailItem[]> {
  // keyword → GB2312 后表单提交（UTF-8 搜不到内容）
  const gbkKeyword = iconv.encode(keyword, 'gbk');
  const form = new URLSearchParams();
  form.set('classid', '0');
  form.set('show', 'title,smalltext');
  form.set('tempid', '1');
  const bodyBytes = Buffer.concat([
    Buffer.from(form.toString() + '&keyboard='),
    gbkKeyword, // GBK 字节不能过 URLSearchParams（会按 UTF-8 重编码），手动拼接
  ]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  let utf8Body: string;
  try {
    const resp = await fetch(`${base}/e/search/index.php`, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: base,
      },
      body: bodyBytes,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (resp.status !== 200) throw new Error(`unexpected status ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    utf8Body = iconv.decode(buf, 'gbk');
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(utf8Body);
  const items: DetailItem[] = [];
  const seen = new Set<string>();
  $('a.ulink[href]').each((_i, a) => {
    const href = ($(a).attr('href') ?? '').trim();
    if (!DETAIL_HREF_REGEX.test(href) || seen.has(href)) return;
    seen.add(href);
    let title = ($(a).attr('title') ?? '').trim();
    if (title === '') title = $(a).text().trim();
    if (title === '') return;
    const date = href.match(DATE_FROM_HREF_REGEX)?.[1] ?? '';
    items.push({ href, title, date });
  });
  return items;
}

function detailID(href: string): string {
  const m = href.match(/(\d+)\.html$/);
  return m ? m[1] : String(Date.now());
}

async function fetchDetail(item: DetailItem): Promise<SearchResult | null> {
  // 详情链接可能带主站绝对地址，统一改走当前镜像
  let href = item.href;
  if (href.startsWith('http')) {
    try {
      href = new URL(href).pathname;
    } catch {
      /* 保留原样 */
    }
  }
  let page = '';
  for (const base of MIRRORS) {
    try {
      page = await fetchGBK(base + href, `${base}/`);
      break;
    } catch {
      continue;
    }
  }
  if (page === '') return null;

  const links: Link[] = [];
  const seenLink = new Set<string>();
  for (const m of page.match(MAGNET_REGEX) ?? []) {
    if (seenLink.has(m)) continue;
    seenLink.add(m);
    links.push({ type: 'magnet', url: m, password: '', work_title: item.title });
  }
  for (const e of page.match(ED2K_REGEX) ?? []) {
    if (seenLink.has(e)) continue;
    seenLink.add(e);
    links.push({ type: 'ed2k', url: e, password: '', work_title: item.title });
  }
  if (links.length === 0) return null;

  // 别名与年代放入 Content，让英文片名/年份也能命中关键词过滤
  const contentParts: string[] = [];
  const alias = page.match(ALIAS_REGEX)?.[1];
  if (alias) contentParts.push(`别名: ${alias.trim()}`);
  const year = page.match(YEAR_REGEX)?.[1];
  if (year) contentParts.push(`年代: ${year}`);
  let content = contentParts.join(' | ');
  if (content === '') content = '来源: 电影天堂';

  let datetime = '';
  if (item.date.length === 8) {
    const parsed = new Date(`${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) datetime = parsed.toISOString();
  }

  const id = detailID(item.href);
  return {
    message_id: `dygod-${id}`,
    unique_id: `dygod-${id}`,
    channel: '',
    datetime,
    title: item.title,
    content,
    links,
  };
}

export const dygod = definePlugin({
  name: 'dygod',
  priority: 2, // 与 ciligou 等纯磁力引擎同级：经典影视站资源质量高
  skipServiceFilter: true, // 磁力源：跳过 Service 层过滤，插件内部按关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    // 逐镜像提交搜索表单
    let items: DetailItem[] = [];
    let lastErr: unknown = null;
    for (const base of MIRRORS) {
      try {
        items = await searchMirror(base, kw);
        if (items.length > 0) break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (items.length === 0) {
      if (lastErr) throw new Error(`[dygod] all mirrors failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
      return [];
    }
    if (items.length > MAX_DETAIL_ITEMS) items = items.slice(0, MAX_DETAIL_ITEMS);

    // 并发抓详情页
    const limit = createLimiter(DETAIL_CONCURRENCY);
    const settled = await Promise.allSettled(items.map((item) => limit(() => fetchDetail(item))));
    const merged = settled.filter((s): s is PromiseFulfilledResult<SearchResult> => s.status === 'fulfilled').map((s) => s.value).filter((r) => r !== null);

    return filterResultsByKeyword(merged, kw);
  },
});
