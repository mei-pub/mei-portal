// Quarksoo 插件 —— Go plugin/quarksoo 的代码级移植
// 站点 quarksoo.cc/search.php：table 行内直接给出剧名 + 夸克链接；
// 标题预过滤（多关键词 AND）→ md5 去重 → 按标题排序 → 关键词二次过滤。
// 有意简化：Go 的 rand.Seed / generateRandomIP（未被调用）无对应物，UA 随机保留；
//           time.Now() 语义保持（datetime 为抓取时刻）。

import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const BASE_URL = 'https://quarksoo.cc/search.php';
const MAX_RETRIES = 2; // 额外重试次数（Go 循环 0..retries，共 3 次尝试）
const REQUEST_TIMEOUT_MS = 30_000; // Go defaultPluginTimeout（后台客户端 30s）

// 常用 UA 列表（Go userAgents）
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** 实体解码 + 折叠空白（Go cleanQuarksooText） */
function cleanText(value: string): string {
  return unescapeEntities(value).trim().split(/\s+/).filter((s) => s !== '').join(' ');
}

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

/** 从 HTML 解析结果：标题预过滤（多关键词 AND）+ 夸克链接（Go parseSearchResults） */
function parseSearchResults(htmlContent: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  const keywords = keyword.toLowerCase().split(/\s+/).filter((k) => k !== '');

  const $ = cheerio.load(htmlContent);
  $('tr').each((_i, el) => {
    const row = $(el);
    const cells = row.find('td');
    if (cells.length < 2) return;

    const title = cleanText(cells.eq(0).text());
    if (title === '' || title.includes('剧名') || title.includes('网盘链接')) return;

    let anchor = cells.eq(1).find('a[href]').first();
    if (anchor.length === 0) anchor = row.find('a[href]').first();
    const linkURL = (anchor.attr('href') ?? '').trim();
    // 原样保留 Go 的 "pan.qoark.cn" 拼写（站点真实使用的域名）
    const lowerLink = linkURL.toLowerCase();
    if (!lowerLink.includes('pan.qoark.cn') && !lowerLink.includes('pan.quark.cn')) return;

    const lowerTitle = title.toLowerCase();
    if (!keywords.every((kw) => lowerTitle.includes(kw))) return;

    const hash = createHash('md5').update(`${title}|${linkURL}`).digest('hex').slice(0, 16); // Go hash[:8] → 16 hex 字符
    results.push({
      message_id: '',
      unique_id: `quarksoo-${hash}`,
      channel: '', // 插件结果 Channel 必须为空
      datetime: new Date().toISOString(),
      title,
      content: '',
      links: [{ type: 'quark', url: linkURL, password: '' }],
    });
  });
  return results;
}

/** 按 UniqueID 去重 + 按标题排序（Go deduplicateResults） */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.unique_id)) continue;
    seen.add(result.unique_id);
    unique.push(result);
  }
  // Go sort.Slice 按 Title 字节序，JS 按码元序（BMP 内一致）
  unique.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return unique;
}

export const quarksoo = definePlugin({
  name: 'quarksoo',
  priority: 3, // 启用 Service 层过滤（skipServiceFilter 为 false）
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}?q=${encodeURIComponent(keyword)}`;

    // 网络错误 / 非 200 均按 500ms 固定间隔重试（Go doSearch 重试循环）。
    // 超时：Go http.Client.Timeout（defaultPluginTimeout=30s）按请求生效 → 每次尝试独立 AbortController
    let lastErr: unknown = null;
    let html = '';
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(searchURL, {
          headers: {
            'User-Agent': getRandomUA(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Connection: 'keep-alive',
            Referer: 'https://quarksoo.cc/',
          },
          signal: controller.signal,
        });
        if (resp.status === 200) {
          html = await resp.text();
          lastErr = null;
          break;
        }
        lastErr = new Error(`API返回非200状态码: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
      if (i === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (lastErr !== null) {
      throw new Error(`[quarksoo] 请求失败: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
    }

    const results = parseSearchResults(html, keyword);
    const uniqueResults = deduplicateResults(results);
    // 关键词二次过滤（Go FilterResultsByKeyword）
    return filterResultsByKeyword(uniqueResults, keyword);
  },
});
