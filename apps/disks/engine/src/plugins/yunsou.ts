// 云搜（无朋盘搜）插件 —— Go plugin/yunsou 的代码级移植
// 站点 wpys.cc：/s/<kw>.html 分页（-<page>），分享链接由 onclick/@click.stop 的
// copyText(...,'url','pwd') 提供；el-pagination :total 决定页数（≤10 页、≤100 条）。
// 有意简化：Go 的 http.Transport 连接池参数在事件循环下无意义，已删；
//           所有页共享同一 30s 截止时间（Go 单一 ctx）；
//           url.QueryEscape(shareURL) 以 encodeURIComponent 等价（分享链接为常规百分号编码，
//           两者仅对 !'()* 等字符有差异，实际数据不出现）；
//           time.Parse(timeLayout) 统一按 UTC 解析。

import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const SEARCH_URL_TEMPLATE = 'https://wpys.cc/s/%s.html';
const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;
const MAX_RESULTS = 100;
const MAX_PAGES = 10;

// 分享链接由 onclick="copyText(...,'url','pwd')" 提供
const COPY_TEXT_REGEX = /copyText\([^,]+,\s*'[^']*',\s*'([^']+)',\s*'([^']*)'/;
const PWD_PARAM_REGEX = /[?&]pwd=([0-9a-zA-Z]+)/;

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

/** 去首尾空白 + 折叠连续空白（Go cleanText） */
function cleanText(value: string): string {
  return value.trim().split(/\s+/).filter((s) => s !== '').join(' ');
}

/** "2006-01-02" → ISO，失败用当前时间（Go parseDate） */
function parseDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function extractPassword(rawURL: string): string {
  return rawURL.match(PWD_PARAM_REGEX)?.[1] ?? '';
}

/** 网盘类型判定（Go diskType） */
function diskType(rawURL: string): string {
  if (rawURL.includes('pan.quark.cn')) return 'quark';
  if (rawURL.includes('pan.baidu.com')) return 'baidu';
  if (rawURL.includes('pan.xunlei.com')) return 'xunlei';
  if (rawURL.includes('aliyundrive.com') || rawURL.includes('alipan.com')) return 'aliyun';
  if (rawURL.includes('drive.uc.cn')) return 'uc';
  return 'others';
}

/** 单页请求：网络错误与非 200 均按 200ms*2^(attempt-1) 退避重试（Go doRequestWithRetry） */
async function fetchPageHTML(requestURL: string, page: number, deadline: number): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`[yunsou] 第${page}页请求超时`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const resp = await fetch(requestURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: 'https://wpys.cc/',
        },
        signal: controller.signal,
      });
      if (resp.status === 200) return await resp.text();
      lastErr = new Error(`状态码 ${resp.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[yunsou] 第${page}页搜索请求失败: 重试 ${MAX_RETRIES} 次后仍然失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** 解析一页结果（Go parseSearchResults） */
function parseSearchResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $('.list .item').each((_i, el) => {
    if (results.length >= MAX_RESULTS) return false;
    const item = $(el);

    let title = item.attr('data-title') ?? '';
    if (title === '') title = item.find('.title').first().text();
    title = cleanText(unescapeEntities(title));
    if (title === '') return;

    // 在任意后代元素上找 onclick / @click.stop 中的 copyText(...,'url','pwd')
    let shareURL = '';
    let password = '';
    item
      .find('*')
      .each((_j, btn) => {
        let onclick = $(btn).attr('onclick') ?? '';
        if (onclick === '') {
          // Vue 绑定在 HTML 中保留为 @click.stop 属性
          onclick = $(btn).attr('@click.stop') ?? '';
        }
        if (onclick === '') return;
        const match = unescapeEntities(onclick).match(COPY_TEXT_REGEX);
        if (match !== null) {
          shareURL = match[1].trim();
          password = match[2].trim();
        }
        if (shareURL !== '') return false; // eachWithBreak：已找到即停
        return;
      });
    if (shareURL === '') return;
    if (password === '') password = extractPassword(shareURL);

    const result: SearchResult = {
      message_id: `yunsou-${encodeURIComponent(shareURL)}`,
      unique_id: `yunsou-${encodeURIComponent(shareURL)}`,
      title,
      channel: '', // 插件结果 Channel 必须为空
      datetime: parseDate(item.find('.type.time').first().text()),
      content: '',
      links: [{ type: diskType(shareURL), url: shareURL, password }],
    };
    const source = cleanText(item.find('.type').first().text());
    if (source !== '') result.content = source;
    results.push(result);
    return;
  });
  return results;
}

export const yunsou = definePlugin({
  name: 'yunsou',
  priority: 2,
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const kw = keyword.trim();
    if (kw === '') return [];

    // Go：所有页共享同一个 30s ctx
    const deadline = Date.now() + DEFAULT_TIMEOUT;

    const firstHTML = await fetchPageHTML(SEARCH_URL_TEMPLATE.replace('%s', encodeURIComponent(kw)), 1, deadline);
    let results = parseSearchResults(firstHTML);

    // el-pagination 的 :total 绑定（Vue 属性名带冒号）
    let total = 0;
    const paginationTotal = cheerio.load(firstHTML)('el-pagination').first().attr(':total');
    if (paginationTotal !== undefined) total = parseInt(paginationTotal, 10) || 0;

    let totalPages = Math.ceil(total / 10);
    if (totalPages < 1) totalPages = 1;
    if (totalPages > MAX_PAGES) totalPages = MAX_PAGES;

    for (let page = 2; page <= totalPages && results.length < MAX_RESULTS; page++) {
      const path = `${encodeURIComponent(kw)}-${page}`;
      try {
        const pageHTML = await fetchPageHTML(SEARCH_URL_TEMPLATE.replace('%s', path), page, deadline);
        results = results.concat(parseSearchResults(pageHTML));
      } catch {
        continue; // 单页失败跳过
      }
    }
    if (results.length > MAX_RESULTS) results = results.slice(0, MAX_RESULTS);
    return filterResultsByKeyword(results, kw);
  },
});
