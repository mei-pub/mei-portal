// 磁力狗/磁力猫 DHT 磁力搜索插件 —— Go plugin/ciligou 的复刻
//
// 站点族：磁力狗（cdn.ciligou.in:39520）与磁力猫（cdn.cilimao.fun:39520）
// 是同族 DHT 磁力引擎的不同部署（对外域名经过 iframe 壳跳转，直连 CDN
// 通道无 Cloudflare 盾）。两站索引各有侧重，聚合后去重输出。
//
// 接口契约：
//   - 列表：GET /search?word=<关键词>&sort=rel&page=N（15 条/页）
//   - 结果项：<a class="SearchListTitle_result_title" href="/information/<40位hash>">
//     href 中的 hash 即 btih，直接构造 magnet 链接，无需请求详情页
//   - 元数据：同 li 内 .Search_list_info 文本含 文件大小/创建时间/文件格式，
//     .Search_result_type 内含热度值

import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.ts';
import { definePlugin, filterResultsByKeyword } from './shared.ts';

const PLUGIN_NAME = 'ciligou';
const SITES = ['https://cdn.ciligou.in:39520', 'https://cdn.cilimao.fun:39520'];
const SEARCH_TIMEOUT = 15_000;
// 每站抓 2 页（30 条），磁力结果按相关性已排序
const MAX_PAGES = 2;

// 插件等级 2 与 clxiong 等纯磁力引擎同级：插件等级分（500）高于等级 3，
// 避免被混合源（网盘+磁力）的大量结果挤压到深页。
const PRIORITY = 2;

const INFORMATION_REGEX = /\/information\/([0-9a-fA-F]{40})/;
const DATE_REGEX = /创建时间[：:]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/;
const SIZE_REGEX = /文件大小[：:]\s*([0-9.]+\s*[KMG]?B)/;
const FORMAT_REGEX = /文件格式[：:]\s*(\S+)/;
const HOT_REGEX = /^\s*([0-9]+)\s*$/;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 抓取单页（状态码必须 200，超时 15s） */
async function fetchPage(searchURL: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const resp = await fetch(searchURL, { headers: REQUEST_HEADERS, signal: controller.signal });
    if (resp.status !== 200) throw new Error(`unexpected status ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 解析结果列表：标题 + hash（构造 magnet）+ 大小/日期/格式/热度 */
function parseResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const items: SearchResult[] = [];

  $('a.SearchListTitle_result_title').each((_i, a) => {
    const href = $(a).attr('href') ?? '';
    const match = href.match(INFORMATION_REGEX);
    if (!match) return;
    const hash = match[1].toLowerCase();

    const title = $(a).text().trim();
    if (title === '') return;

    // 元数据在同一个列表项内：向上找 li 内的 .Search_list_info / .Search_result_type
    const li = $(a).closest('li');
    const infoText = li.find('.Search_list_info').first().text().trim();
    const hotMatch = li.find('.Search_result_type').first().text().trim().match(HOT_REGEX);
    const hotness = hotMatch ? hotMatch[1] : '';

    const contentParts: string[] = [];
    const sizeMatch = infoText.match(SIZE_REGEX);
    if (sizeMatch) contentParts.push(`大小: ${sizeMatch[1]}`);
    const formatMatch = infoText.match(FORMAT_REGEX);
    if (formatMatch) contentParts.push(`格式: ${formatMatch[1]}`);
    if (hotness !== '') contentParts.push(`热度: ${hotness}`);

    // 无创建时间时 Go 为零值时间，这里以空字符串表示
    let datetime = '';
    const dateMatch = infoText.match(DATE_REGEX);
    if (dateMatch) datetime = new Date(`${dateMatch[1]}T00:00:00`).toISOString();

    items.push({
      message_id: '',
      unique_id: `${PLUGIN_NAME}-${hash}`,
      channel: '',
      datetime,
      title,
      content: contentParts.join(' | '),
      links: [{ type: 'magnet', url: `magnet:?xt=urn:btih:${hash}`, password: '' }],
    });
  });

  return items;
}

interface SiteOutcome {
  results: SearchResult[];
  err: unknown;
}

/** 抓取单个站点的搜索结果页（sort=rel 按相关性，翻 MAX_PAGES 页） */
async function searchSite(base: string, keyword: string): Promise<SiteOutcome> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let siteErr: unknown = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const searchURL = `${base}/search?word=${encodeURIComponent(keyword)}&sort=rel&page=${page}`;
    let html: string;
    try {
      html = await fetchPage(searchURL);
    } catch (err) {
      // Go 语义：出错时返回已收集的部分结果 + 错误
      siteErr = err;
      break;
    }
    const pageItems = parseResults(html);
    if (pageItems.length === 0) break; // 无更多结果（空页或超末页）
    for (const item of pageItems) {
      if (seen.has(item.unique_id)) continue;
      seen.add(item.unique_id);
      results.push(item);
    }
  }
  return { results, err: siteErr };
}

export const ciligou = definePlugin({
  name: PLUGIN_NAME,
  priority: PRIORITY,
  skipServiceFilter: true, // 磁力类宽泛结果，跳过 Service 层关键词过滤
  async search(keyword: string, _ext: Record<string, unknown>): Promise<SearchResult[]> {
    // 两站并发抓取（Go 为每站一个 goroutine）
    const outcomes = await Promise.all(SITES.map((base) => searchSite(base, keyword)));

    // 跨站去重（同 hash 只保留首次出现），任一站有结果即成功
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    let firstErr: unknown = null;
    for (const entry of outcomes) {
      if (entry.err !== null && firstErr === null) firstErr = entry.err;
      for (const item of entry.results) {
        if (seen.has(item.unique_id)) continue;
        seen.add(item.unique_id);
        results.push(item);
      }
    }
    if (results.length === 0 && firstErr !== null) {
      throw new Error(`[${PLUGIN_NAME}] all sites failed: ${firstErr instanceof Error ? firstErr.message : firstErr}`);
    }

    return filterResultsByKeyword(results, keyword);
  },
});
