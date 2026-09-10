// 插件注册表 —— Go plugin 包全局注册表的 TS 对应物
// 差异：Go 用 init() 空导入自注册；这里用显式 import + registerPlugin（apps/disks/engine/src/plugins/index.ts）

import type { SearchPlugin } from '../types.ts';

const registry = new Map<string, SearchPlugin>();

export function registerPlugin(plugin: SearchPlugin): void {
  registry.set(plugin.name, plugin);
}

export function getPluginByName(name: string): SearchPlugin | undefined {
  return registry.get(name);
}

export function getPlugins(): SearchPlugin[] {
  return [...registry.values()];
}

/** 按启用清单过滤：null（未设置 ENABLED_PLUGINS）= 不加载任何插件 */
export function filterEnabledPlugins(enabled: string[] | null): SearchPlugin[] {
  if (enabled === null) return [];
  if (enabled.length === 0) return [];
  const wanted = new Set(enabled.map((p) => p.toLowerCase()));
  return getPlugins().filter((p) => wanted.has(p.name.toLowerCase()));
}
