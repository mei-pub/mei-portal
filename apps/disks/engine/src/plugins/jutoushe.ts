// 剧透社插件 —— Go plugin/jutoushe 的代码级移植
// 站点 1.star2.cn：搜索页 ul.erx-list li.item → 逐条（Go 为同步顺序）抓详情页
// .dlipp-cont-bd a.dlipp-dl-btn 解出网盘链接。
// 有意简化：time.Parse / time.Date(time.Local) 统一按 UTC 解析（与仓库其他插件一致）；
//           Go 的详情抓取在 .Each 循环内同步进行，此处保持顺序执行语义。

import * as cheerio from 'cheerio';
import type { Link, SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://1.star2.cn';
const SEARCH_TIMEOUT = 30_000;
const DETAIL_TIMEOUT = 15_000;
const MAX_RETRIES = 3;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  Referer: `${BASE_URL}/`,
};

/** 搜索请求：网络错误与非 200 均 200ms*2^(i-1) 退避重试（Go doRequestWithRetry） */
async function fetchSearchPage(searchURL: string): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
    try {
      const resp = await fetch(searchURL, { headers: BROWSER_HEADERS, signal: controller.signal });
      if (resp.status === 200) return await resp.text();
      lastErr = new Error(`[jutoushe] 请求返回状态码: ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`重试 ${MAX_RETRIES} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 详情页：无重试，失败返回空（Go getDetailLinks） */
async function getDetailLinks(detailURL: string): Promise<Link[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT);
  let html: string;
  try {
    const resp = await fetch(detailURL, {
      // Go getDetailLinks 不设 Connection 头，其余与搜索一致
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: BROWSER_HEADERS.Accept,
        'Accept-Language': BROWSER_HEADERS['Accept-Language'],
        Referer: BROWSER_HEADERS.Referer,
      },
      signal: controller.signal,
    });
    if (resp.status !== 200) return [];
    html = await resp.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const $ = cheerio.load(html);
  const links: Link[] = [];
  $('.dlipp-cont-bd a.dlipp-dl-btn').each((_i, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (href === '') return;
    if (!isValidNetworkDriveURL(href)) return;
    links.push({ type: determineCloudType(href), url: href, password: extractPassword(href) });
  });
  return links;
}

/** 网盘类型判定（Go determineCloudType） */
function determineCloudType(url: string): string {
  if (url.includes('pan.quark.cn')) return 'quark';
  if (url.includes('drive.uc.cn')) return 'uc';
  if (url.includes('pan.baidu.com')) return 'baidu';
  if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
  if (url.includes('pan.xunlei.com')) return 'xunlei';
  if (url.includes('cloud.189.cn')) return 'tianyi';
  if (url.includes('115.com')) return '115';
  if (url.includes('123pan.com')) return '123';
  if (url.includes('caiyun.139.com')) return 'mobile';
  if (url.includes('mypikpak.com')) return 'pikpak';
  return 'others';
}

/** 百度网盘 pwd 参数提取（Go extractPassword） */
function extractPassword(url: string): string {
  if (url.includes('pan.baidu.com') && url.includes('pwd=')) {
    const m = url.match(/pwd=([^&]+)/);
    if (m) return m[1];
  }
  // 其他网盘暂不处理提取码
  return '';
}

/** 已知网盘域名校验（Go isValidNetworkDriveURL） */
function isValidNetworkDriveURL(url: string): boolean {
  if (url === '') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  const knownDomains = [
    'pan.quark.cn', 'drive.uc.cn', 'pan.baidu.com',
    'aliyundrive.com', 'alipan.com', 'pan.xunlei.com',
    'cloud.189.cn', '115.com', '123pan.com',
    'caiyun.139.com', 'mypikpak.com',
  ];
  return knownDomains.some((domain) => url.includes(domain));
}

/** /dm/8100.html → 8100，失败则路径替换斜杠（Go extractIDFromURL） */
function extractIDFromURL(urlPath: string): string {
  const m = urlPath.match(/\/([^/]+)\/(\d+)\.html/);
  if (m) return m[2];
  return urlPath.split('/').join('_');
}

/** 【分类】标签提取（Go extractTags） */
function extractTags(title: string): string[] {
  const tags: string[] = [];
  for (const m of title.matchAll(/【([^】]+)】/g)) {
    tags.push(m[1]);
  }
  if (tags.length === 0) tags.push('影视资源');
  return tags;
}

/** 日期解析：YYYY-MM-DD / YYYY年M月D日，失败用当前时间（Go parseDate，时区按 UTC） */
function parseDate(dateStr: string): string {
  dateStr = dateStr.trim();
  if (dateStr === '') return new Date().toISOString();

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const parsed = new Date(`${dateStr}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const m = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const parsed = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export const jutoushe = definePlugin({
  name: 'jutoushe',
  priority: 1,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}/search/?keyword=${encodeURIComponent(keyword)}`;
    const html = await fetchSearchPage(searchURL);
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];
    const list: Array<{ title: string; detailPath: string; timeStr: string }> = [];
    $('ul.erx-list li.item').each((_i, el) => {
      const s = $(el);
      const linkElem = s.find('.a a.main');
      const title = linkElem.text().trim();
      const detailPath = linkElem.attr('href');
      if (detailPath === undefined || title === '') return; // 跳过无效项
      list.push({ title, detailPath, timeStr: s.find('.i span.time').text().trim() });
    });

    // 详情页逐条抓取（Go 在 .Each 循环内同步进行）
    for (const { title, detailPath, timeStr } of list) {
      const detailURL = BASE_URL + detailPath;
      const links = await getDetailLinks(detailURL);
      if (links.length === 0) continue;

      results.push({
        message_id: '',
        unique_id: `jutoushe-${extractIDFromURL(detailPath)}`,
        channel: '', // 插件结果 Channel 必须为空
        datetime: parseDate(timeStr),
        title,
        content: `剧透社影视资源：${title}`,
        tags: extractTags(title),
        links,
      });
    }

    return filterResultsByKeyword(results, keyword);
  },
});
