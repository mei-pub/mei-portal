// 插件装配 —— 对应 Go main.go 的空导入注册
// 新插件：src/plugins/<name>.ts 内 definePlugin(...)，然后在此 import 并加入 PLUGIN_DEFS。

import { config } from '../config.ts';
import type { SearchPlugin } from '../types.ts';
import { filterEnabledPlugins, getPlugins } from './registry.ts';

// ---- 插件清单（显式 import 替代 Go 的 init() 空导入自注册）----
import './quarkres.ts';
import './nyaa.ts';
import './dygod.ts';

/** 全部已注册插件 */
export function allPluginDefs(): SearchPlugin[] {
  return getPlugins();
}

/** 当前配置下启用的插件（ENABLED_PLUGINS 三态语义） */
export function enabledPluginDefs(): SearchPlugin[] {
  return filterEnabledPlugins(config.enabledPlugins);
}
