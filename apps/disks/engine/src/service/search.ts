// 搜索服务 —— Go service/search_service.go Search()/searchTG/searchPlugins/mergeResultsByType 的复刻

import { config } from '../config.ts';
import { cache, generatePluginCacheKey, generateTGCacheKey } from '../cache.ts';
import { buildSearchURL, createLimiter, fetchText } from '../http.ts';
import { parseSearchResults, cutTitleByKeywords } from '../parser.ts';
import {
  getKeywordPriority,
  getPluginLevelBySource,
  getResultSource,
  mergeSearchResults,
  sortResultsByTimeAndKeywords,
} from '../merge.ts';
import { getPluginByName } from '../plugins/registry.ts';
import { runPluginSearch } from '../plugins/base.ts';
import { enabledPluginDefs } from '../plugins/index.ts';
import { extractLinkTitlePairs, cleanTitle } from './link-pairs.ts';
import type { MergedLink, MergedLinks, SearchResult, SearchResponse } from '../types.ts';

/** Go time.Time.IsZero() 的对应判断 */
function hasDatetime(r: SearchResult): boolean {
  return r.datetime !== '' && r.datetime !== undefined && !r.datetime.startsWith('0001-');
}

export interface SearchParams {
  keyword: string;
  channels: string[];
  concurrency: number;
  forceRefresh: boolean;
  resultType: string; // merged_by_type | all | results
  sourceType: string; // all | tg | plugin
  plugins: string[] | null;
  cloudTypes: string[] | null;
  ext: Record<string, unknown>;
}

/** 搜索单个频道（Go searchChannel） */
async function searchChannel(keyword: string, channel: string): Promise<SearchResult[]> {
  const url = buildSearchURL(channel, keyword, '');
  const html = await fetchText(url, { timeoutMs: 4000 });
  return parseSearchResults(html, channel);
}

/** 搜索 TG 频道（Go searchTG）：缓存 → 并行抓取 → 异步回写缓存 */
async function searchTG(keyword: string, channels: string[], forceRefresh: boolean): Promise<SearchResult[]> {
  const cacheKey = generateTGCacheKey(keyword, channels);
  const ttlMs = config.cacheTTLMinutes * 60 * 1000;

  if (!forceRefresh && config.cacheEnabled) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const limit = createLimiter(Math.max(channels.length, 1));
  const settled = await Promise.allSettled(
    channels.map((channel) => limit(() => searchChannel(keyword, channel))),
  );
  const results: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') results.push(...s.value);
  }

  if (config.cacheEnabled) {
    // 异步缓存（不阻塞返回）
    setTimeout(() => cache.set(cacheKey, results, ttlMs), 0);
  }
  return results;
}

/** 搜索插件（Go searchPlugins）：缓存 → 并行 → 只留有链接的结果 → 异步回写 */
async function searchPlugins(
  keyword: string,
  plugins: string[] | null,
  forceRefresh: boolean,
  concurrency: number,
  ext: Record<string, unknown>,
): Promise<SearchResult[]> {
  const extWithRefresh: Record<string, unknown> = { ...ext };
  if (forceRefresh) extWithRefresh['refresh'] = true;

  const cacheKey = generatePluginCacheKey(keyword, plugins);
  if (!forceRefresh && config.cacheEnabled) {
    const cached = cache.get(cacheKey);
    if (cached) {
      if (config.asyncLogEnabled) console.log(`✅ [${keyword}] 命中缓存 结果数: ${cached.length}`);
      return cached;
    }
  }

  // 按请求过滤插件；未指定（null/空/全空）= 全部
  let available = [...enabledPluginDefs()];
  if (plugins !== null && plugins.length > 0 && plugins.some((p) => p !== '')) {
    const wanted = new Set(plugins.filter((p) => p !== '').map((p) => p.toLowerCase()));
    available = available.filter((p) => wanted.has(p.name.toLowerCase()));
  }

  const limit = createLimiter(Math.max(concurrency, 1));
  const settled = await Promise.allSettled(
    available.map((plugin) => limit(() => runPluginSearch(plugin, keyword, extWithRefresh, cacheKey))),
  );
  const allResults: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      for (const result of s.value) {
        if (result.links.length > 0) allResults.push(result);
      }
    }
  }

  if (config.cacheEnabled) {
    // 主程序最后更新（异步，不阻塞）
    setTimeout(() => cache.set(cacheKey, allResults, config.cacheTTLMinutes * 60 * 1000), 0);
  }
  return allResults;
}

/** 无换行内容的前缀切割补充配对（search_service.go L1006-1057） */
function prefixSplitTitles(content: string, links: Array<{ url: string }>): Map<string, string> {
  const map = new Map<string, string>();
  const linkPrefixes = ['天翼链接：', '百度链接：', '夸克链接：', '阿里链接：', 'UC链接：', '115链接：', '迅雷链接：', '123链接：', '链接：'];
  const prefix = linkPrefixes.find((p) => content.includes(p));
  if (!prefix) return map;
  const parts = content.split(prefix);
  if (parts.length <= 1 || links.length > parts.length - 1) return map;

  const titles: string[] = [cleanTitle(parts[0])];
  const endChars = [' ', '窃', '东', '迎', '千', '我', '恋', '将', '野', '合', '集', '天', '翼', '网', '盘', '(', '（'];
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    const linkEnd = [...part].findIndex((c) => endChars.includes(c));
    if (linkEnd > 0) titles.push(cleanTitle(part.slice(linkEnd)));
  }
  links.forEach((link, i) => {
    if (i < titles.length) map.set(link.url, titles[i]);
  });
  return map;
}

/** 按网盘类型分组合并链接（Go mergeResultsByType） */
export function mergeResultsByType(
  results: SearchResult[],
  keyword: string,
  cloudTypes: string[] | null,
): MergedLinks {
  const uniqueLinks = new Map<string, MergedLink>();
  const lowerKeyword = keyword.toLowerCase();

  for (const result of results) {
    let linkTitleMap = extractLinkTitlePairs(result.content);

    // 无换行且没配对到标题：前缀切割补充
    if (linkTitleMap.size === 0 && result.links.length > 0 && !result.content.includes('\n')) {
      linkTitleMap = prefixSplitTitles(result.content, result.links);
    }

    for (const link of result.links) {
      let title = result.title;
      if (link.work_title && link.work_title !== '') {
        title = link.work_title;
      } else {
        const specificTitle = linkTitleMap.get(link.url);
        if (specificTitle && specificTitle !== '') {
          title = specificTitle;
        } else {
          for (const [mappedLink, mappedTitle] of linkTitleMap) {
            if (mappedLink.startsWith(link.url)) {
              title = mappedTitle;
              break;
            }
          }
        }
      }

      // 插件是否跳过 Service 层关键词过滤（按 UniqueID 前缀查注册表）
      let skipKeywordFilter = false;
      if (result.unique_id !== '' && result.unique_id.includes('-')) {
        const pluginName = result.unique_id.split('-')[0];
        const pluginInstance = getPluginByName(pluginName);
        if (pluginInstance) skipKeywordFilter = pluginInstance.skipServiceFilter;
      }

      // 关键词过滤：只检查链接具体标题
      if (!skipKeywordFilter && keyword !== '') {
        if (!title.toLowerCase().includes(lowerKeyword)) continue;
      }

      // 数据来源
      let source = 'unknown';
      if (result.channel !== '') {
        source = `tg:${result.channel}`;
      } else if (result.unique_id !== '' && result.unique_id.includes('-')) {
        source = `plugin:${result.unique_id.split('-')[0]}`;
      }

      title = cutTitleByKeywords(title, ['简介', '描述']);

      const linkDatetime = link.datetime && link.datetime !== '' ? link.datetime : result.datetime;
      const mergedLink: MergedLink = {
        url: link.url,
        password: link.password,
        note: title,
        datetime: linkDatetime,
        source,
        images: result.images,
      };

      const existing = uniqueLinks.get(link.url);
      // Go：Datetime.After() 严格大于才替换。无效/缺失时间必须折算为 0（Go 的 time.Time 零值），
      // 否则 new Date('') → NaN，NaN 参与比较恒为 false，带有效时间的链接永远无法替换空时间旧链接
      const newTime = new Date(mergedLink.datetime).getTime() || 0;
      const existTime = new Date(existing?.datetime).getTime() || 0;
      if (!existing || newTime > existTime) {
        uniqueLinks.set(link.url, mergedLink);
      }
    }
  }

  // 按原始 results 顺序产出有序唯一链接（保持排序顺序而非随机遍历 map）
  const orderedLinks: MergedLink[] = [];
  const linkTypeMap = new Map<string, string>();
  const added = new Set<string>();
  for (const result of results) {
    for (const link of result.links) {
      const mergedLink = uniqueLinks.get(link.url);
      if (mergedLink && !added.has(link.url)) {
        added.add(link.url);
        orderedLinks.push(mergedLink);
        linkTypeMap.set(link.url, link.type);
      }
    }
  }

  const mergedLinks: MergedLinks = {};
  for (const mergedLink of orderedLinks) {
    const linkType = linkTypeMap.get(mergedLink.url) || 'unknown';
    (mergedLinks[linkType] ??= []).push(mergedLink);
  }

  // cloud_types 白名单过滤
  if (cloudTypes && cloudTypes.length > 0) {
    const allowed = new Set(cloudTypes.map((t) => t.toLowerCase().trim()));
    const filtered: MergedLinks = {};
    for (const [linkType, links] of Object.entries(mergedLinks)) {
      if (allowed.has(linkType.toLowerCase())) filtered[linkType] = links;
    }
    return filtered;
  }

  return mergedLinks;
}

/** 根据结果类型过滤响应（Go filterResponseByType） */
function filterResponseByType(response: SearchResponse, resultType: string): SearchResponse {
  switch (resultType) {
    case 'all':
      return response;
    case 'results':
      return { total: response.total, results: response.results };
    case 'merged_by_type':
    default:
      return { total: response.total, merged_by_type: response.merged_by_type };
  }
}

/** 主搜索（Go Search） */
export async function search(params: SearchParams): Promise<SearchResponse> {
  const { keyword, channels, concurrency, forceRefresh, sourceType, plugins, cloudTypes, ext } = {
    ...params,
    ext: params.ext ?? {},
  };
  const src = sourceType === '' ? 'all' : sourceType;
  const conc = concurrency > 0 ? concurrency : config.defaultConcurrency;

  const [tgResults, pluginResults] = await Promise.all([
    src === 'all' || src === 'tg' ? searchTG(keyword, channels, forceRefresh) : Promise.resolve<SearchResult[]>([]),
    src === 'all' || src === 'plugin'
      ? config.asyncPluginEnabled
        ? searchPlugins(keyword, src === 'tg' ? null : plugins, forceRefresh, conc, ext)
        : Promise.resolve<SearchResult[]>([])
      : Promise.resolve<SearchResult[]>([]),
  ]);

  // 合并 + 排序
  const allResults = mergeSearchResults(tgResults, pluginResults);
  sortResultsByTimeAndKeywords(allResults);

  // Results 过滤：有时间 / 含优先关键词 / 高等级插件（1-2 级）
  const filteredForResults = allResults.filter((result) => {
    const source = getResultSource(result);
    const pluginLevel = getPluginLevelBySource(source);
    return hasDatetime(result) || getKeywordPriority(result.title) > 0 || pluginLevel <= 2;
  });

  // 按类型分组合并（使用全部结果，Go 行为如此）
  const mergedLinks = mergeResultsByType(allResults, keyword, cloudTypes);

  let total: number;
  if (params.resultType === 'merged_by_type') {
    total = Object.values(mergedLinks).reduce((sum, links) => sum + links.length, 0);
  } else {
    total = filteredForResults.length;
  }

  return filterResponseByType(
    { total, results: filteredForResults, merged_by_type: mergedLinks },
    params.resultType,
  );
}
