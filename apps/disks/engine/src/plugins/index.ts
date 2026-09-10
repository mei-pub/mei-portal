// 插件装配 —— 对应 Go main.go 的空导入注册
// 新插件：src/plugins/<name>.ts 内 definePlugin(...)，然后在此 import 并加入 PLUGIN_DEFS。

import { config } from '../config.ts';
import type { SearchPlugin } from '../types.ts';
import { filterEnabledPlugins, getPlugins } from './registry.ts';

// ---- 插件清单（显式 import 替代 Go 的 init() 空导入自注册）----
import './quarkres.ts';
import './nyaa.ts';
import './dygod.ts';
// 磁力/电驴引擎
import './ciligou.ts';
import './cldi.ts';
import './btbtlb.ts';
import './clmao.ts';
import './u3c3.ts';
import './ys5266.ts';
import './dygang.ts';
import './leso.ts';
// 网盘/影视资源站
import './pansearch.ts';
import './dy4k.ts';
import './xb6v.ts';
import './hdmoli.ts';
import './huban.ts';
import './susu.ts';
import './diduan.ts';
import './zhizhen.ts';
// 磁力/电驴引擎（续）
import './thepiratebay.ts';
// 网盘/影视资源站（续）
import './dyyjpro.ts';
import './duoduo.ts';
import './djgou.ts';
import './gaoqing888.ts';
import './haitunsou.ts';
import './hunhepan.ts';
import './ikantv.ts';
import './jutoushe.ts';
import './kkv.ts';
import './melost.ts';
import './meitizy.ts';
import './ouge.ts';
import './quarksoo.ts';
import './ting77.ts';
import './wanou.ts';
import './xiaokupan.ts';
import './xiaozhang.ts';
import './xiaoyu.ts';
import './yunso.ts';
import './yunsou.ts';
import './erxiao.ts';
import './labi.ts';
import './shandian.ts';
import './clxiong.ts';
import './jsnoteclub.ts';
import './dyyj.ts';
import './jupansou.ts';
// 账号型插件（含 Web 管理路由：/gying /qqpd /weibo /panlian）
import './gying.ts';
import './weibo.ts';
import './qqpd.ts';
import './panlian.ts';


/** 全部已注册插件 */
export function allPluginDefs(): SearchPlugin[] {
  return getPlugins();
}

/** 当前配置下启用的插件（ENABLED_PLUGINS 三态语义） */
export function enabledPluginDefs(): SearchPlugin[] {
  return filterEnabledPlugins(config.enabledPlugins);
}
