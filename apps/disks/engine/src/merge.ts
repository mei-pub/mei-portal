// 结果合并/评分/排序 —— Go service/search_service.go 中 merge 与评分部分的复刻

import type { SearchResult } from './types.ts';
import { getPluginByName } from './plugins/registry.ts';

/** 优先关键词列表（索引越小优先级越高） */
export const PRIORITY_KEYWORDS = ['合集', '系列', '全', '完', '最新', '附', 'complete'];

/** 生成结果唯一键（Go generateResultKey） */
export function generateResultKey(result: SearchResult): string {
  if (result.unique_id !== '') return result.unique_id;
  if (result.message_id !== '') return result.message_id;
  return `title_${result.title}_${result.channel}`;
}

/** 计算信息完整度得分（Go calculateCompletenessScore） */
export function calculateCompletenessScore(result: SearchResult): number {
  let score = 0;
  if (result.unique_id !== '') score += 10;
  if (result.links.length > 0) {
    score += 5;
    score += result.links.length;
  }
  if (result.content !== '') score += 3;
  score += Math.floor(result.title.length / 10);
  if (result.channel !== '') score += 2;
  score += result.tags?.length ?? 0;
  return score;
}

/** 智能合并：按唯一键去重并保留最完整信息，按时间倒序（Go mergeSearchResults） */
export function mergeSearchResults(existing: SearchResult[], newResults: SearchResult[]): SearchResult[] {
  const resultMap = new Map<string, SearchResult>();
  for (const result of existing) resultMap.set(generateResultKey(result), result);
  for (const newResult of newResults) {
    const key = generateResultKey(newResult);
    const existingResult = resultMap.get(key);
    if (existingResult) {
      resultMap.set(key, selectBetterResult(existingResult, newResult));
    } else {
      resultMap.set(key, newResult);
    }
  }
  const merged = [...resultMap.values()];
  merged.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  return merged;
}

function selectBetterResult(existing: SearchResult, candidate: SearchResult): SearchResult {
  return calculateCompletenessScore(candidate) > calculateCompletenessScore(existing) ? candidate : existing;
}

/** 从结果推断数据来源（Go getResultSource） */
export function getResultSource(result: SearchResult): string {
  if (result.channel !== '') return `tg:${result.channel}`;
  if (result.unique_id !== '' && result.unique_id.includes('-')) {
    return `plugin:${result.unique_id.split('-')[0]}`;
  }
  return 'unknown';
}

/** 根据来源获取插件等级（Go getPluginLevelBySource；TG 等同等级 3） */
export function getPluginLevelBySource(source: string): number {
  const parts = source.split(':');
  if (parts.length !== 2) return 3;
  if (parts[0] === 'tg') return 3;
  if (parts[0] === 'plugin') {
    const plugin = getPluginByName(parts[1]);
    return plugin ? plugin.priority : 3;
  }
  return 3;
}

/** 插件等级得分（Go getPluginLevelScore） */
export function getPluginLevelScore(source: string): number {
  const level = getPluginLevelBySource(source);
  switch (level) {
    case 1:
      return 1000;
    case 2:
      return 500;
    case 3:
      return 0;
    case 4:
      return -200;
    default:
      return 0;
  }
}

/** 标题优先关键词得分（Go getKeywordPriority，最高 490） */
export function getKeywordPriority(title: string): number {
  const t = title.toLowerCase();
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (t.includes(PRIORITY_KEYWORDS[i])) return (PRIORITY_KEYWORDS.length - i) * 70;
  }
  return 0;
}

/** 时间得分（Go calculateTimeScore，最新 500 → 一年以上 20） */
export function calculateTimeScore(datetimeStr: string): number {
  if (!datetimeStr) return 0;
  const datetime = new Date(datetimeStr);
  if (Number.isNaN(datetime.getTime())) return 0;
  const daysDiff = (Date.now() - datetime.getTime()) / 1000 / 60 / 60 / 24;
  if (daysDiff <= 1) return 500;
  if (daysDiff <= 3) return 400;
  if (daysDiff <= 7) return 300;
  if (daysDiff <= 30) return 200;
  if (daysDiff <= 90) return 100;
  if (daysDiff <= 365) return 50;
  return 20;
}

/** 综合排序：时间 + 关键词 + 插件等级（Go sortResultsByTimeAndKeywords，就地排序） */
export function sortResultsByTimeAndKeywords(results: SearchResult[]): void {
  results.sort((a, b) => {
    const scoreA = calculateTimeScore(a.datetime) + getKeywordPriority(a.title) + getPluginLevelScore(getResultSource(a));
    const scoreB = calculateTimeScore(b.datetime) + getKeywordPriority(b.title) + getPluginLevelScore(getResultSource(b));
    return scoreB - scoreA;
  });
}
