// 插件公共助手 —— Go plugin.FilterResultsByKeyword 与插件定义工厂

import type { SearchPlugin, SearchResult } from '../types.ts';
import { registerPlugin } from './registry.ts';

/** 按关键词过滤结果（多关键词按空格分割，AND 关系，匹配标题或内容）（Go FilterResultsByKeyword） */
export function filterResultsByKeyword(results: SearchResult[], keyword: string): SearchResult[] {
  if (keyword === '') return results;
  const lowerKeyword = keyword.toLowerCase();
  const keywords = lowerKeyword.split(/\s+/).filter((k) => k !== '');
  return results.filter((result) => {
    const lowerTitle = result.title.toLowerCase();
    const lowerContent = result.content.toLowerCase();
    return keywords.every((kw) => lowerTitle.includes(kw) || lowerContent.includes(kw));
  });
}

export interface PluginDefinition {
  name: string;
  priority: number;
  /** 磁力类宽泛结果插件设 true：跳过 Service 层关键词过滤 */
  skipServiceFilter?: boolean;
  search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]>;
}

/** 定义并注册插件（对应 Go 的 init() + RegisterGlobalPlugin） */
export function definePlugin(def: PluginDefinition): SearchPlugin {
  const plugin: SearchPlugin = {
    name: def.name,
    priority: def.priority,
    skipServiceFilter: def.skipServiceFilter ?? false,
    search: def.search,
  };
  registerPlugin(plugin);
  return plugin;
}
