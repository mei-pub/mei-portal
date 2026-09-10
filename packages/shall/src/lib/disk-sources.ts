/**
 * 网盘搜索源注册表（唯一真源）。
 *
 * 元数据覆盖 pansou 后端已部署与可能启用的搜索插件：中文名、分类、
 * 是否需要配置账户。TG 频道没有逐个语义，只维护磁力频道集合用于
 * 设置页分组展示。
 *
 * 分类依据（2026-09-08 实测 + 上游 docs/插件修复TODO-2026-09-01.md）：
 * - cloud：以网盘分享链接为主要产出（网盘聚合站、影视资源站附带网盘）
 * - magnet：以 magnet:// ed2k:// 链接为主要产出
 *
 * 维护约定：pansou ENABLED_PLUGINS 变更时同步此表；新插件未登记时
 * 设置页按 id 原样展示并归入「未分类」，不会报错。
 */

export type DiskSourceCategory = 'cloud' | 'magnet';

export interface DiskPluginMeta {
  id: string;
  /** 面向用户的可读名称 */
  name: string;
  category: DiskSourceCategory;
  /** 需要先在网盘应用内配置账户/登录，否则无结果 */
  needsAccount?: boolean;
  /** 备注（如：源站对部分 IP 风控，建议配置代理） */
  note?: string;
}

export const DISK_PLUGINS: DiskPluginMeta[] = [
  // ---- 网盘与网页源（cloud）----
  { id: 'jutoushe', name: '剧透社', category: 'cloud' },
  { id: 'pansearch', name: '盘搜', category: 'cloud', note: '源站对部分 IP 风控，无结果时建议配置代理' },
  { id: 'panlian', name: '盘链', category: 'cloud', needsAccount: true },
  { id: 'quarkres', name: '夸克资源社', category: 'cloud', note: 't.me/quark_res 官方数据源；接口待上游修复，暂无结果' },
  { id: 'quarksoo', name: '夸克搜', category: 'cloud' },
  { id: 'haitunsou', name: '海豚搜', category: 'cloud' },
  { id: 'hunhepan', name: '混合盘', category: 'cloud' },
  { id: 'xiaokupan', name: '小酷盘', category: 'cloud' },
  { id: 'jupansou', name: '聚盘搜', category: 'cloud' },
  { id: 'wanou', name: '玩偶盘', category: 'cloud' },
  { id: 'jsnoteclub', name: 'JS 笔记', category: 'cloud' },
  { id: 'meitizy', name: '美蹄资源', category: 'cloud' },
  { id: 'discourse', name: 'Linux.do', category: 'cloud', note: '受登录与访问策略限制，结果不稳定' },
  { id: 'xiaoyu', name: '小鱼资源', category: 'cloud' },
  { id: 'ting77', name: '听 77', category: 'cloud' },
  { id: '5266ys', name: '5266 影视', category: 'cloud' },
  { id: 'duoduo', name: '多多盘', category: 'cloud' },
  { id: 'dyyj', name: '电影驿站', category: 'cloud' },
  { id: 'dyyjpro', name: '电影驿站 Pro', category: 'cloud' },
  { id: 'diduan', name: '低端影视', category: 'cloud' },
  { id: 'kkv', name: 'KKV 盘', category: 'cloud' },
  { id: 'xiaozhang', name: '小张资源', category: 'cloud' },
  { id: 'mizixing', name: '觅字星', category: 'cloud' },
  { id: 'yunso', name: '云搜', category: 'cloud' },
  { id: 'yunsou', name: '云搜 Plus', category: 'cloud' },
  { id: 'susu', name: '速搜', category: 'cloud' },
  { id: 'alupan', name: '阿鲁盘', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'hdmoli', name: 'HD 魔粒', category: 'cloud' },
  { id: 'ikantv', name: '爱看 TV', category: 'cloud' },
  { id: 'gying', name: '广影', category: 'cloud', needsAccount: true },
  { id: 'weibo', name: '微博资源', category: 'cloud', needsAccount: true },
  { id: 'qqpd', name: 'QQ 频道', category: 'cloud', needsAccount: true },
  { id: 'djgou', name: 'DJ 狗', category: 'cloud' },
  { id: 'ouge', name: '欧歌盘', category: 'cloud' },
  { id: 'xb6v', name: '6V 电影', category: 'cloud' },
  { id: 'ahhhhfs', name: '阿福搜索', category: 'cloud', note: '接口待上游确认，结果不稳定' },
  { id: 'haisou', name: '海搜', category: 'cloud', note: '接口待上游确认，结果不稳定' },
  { id: 'miaoso', name: '喵搜盘', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'wuji', name: '无极盘', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'leijing', name: '雷鲸小站', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'bixin', name: '必信盘', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'ash', name: 'ASH 盘', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'aikanzy', name: '爱看资源', category: 'cloud', note: '源站 Cloudflare 盾，结果不稳定' },
  { id: 'panwiki', name: '盘 Wiki', category: 'cloud' },
  { id: 'pan666', name: '盘 666', category: 'cloud' },

  // ---- 磁力与电驴源（magnet）----
  { id: 'ciligou', name: '磁力狗', category: 'magnet', note: '聚合磁力狗+磁力猫双 DHT 引擎' },
  { id: 'clmao', name: '磁力猫', category: 'magnet' },
  { id: 'clxiong', name: '磁力熊', category: 'magnet' },
  { id: 'cldi', name: '磁力帝', category: 'magnet', note: '轮换域名 DHT 引擎，自动解析御选入口' },
  { id: 'dygod', name: '电影天堂', category: 'magnet' },
  { id: 'btbtlb', name: 'BT影视', category: 'magnet' },
  { id: 'thepiratebay', name: '海盗湾', category: 'magnet', note: '境外源，无代理时无结果' },
  { id: 'nyaa', name: 'Nyaa 番剧', category: 'magnet', note: '境外源，无代理时无结果' },
  { id: 'melost', name: 'Melost', category: 'magnet' },
  { id: 'erxiao', name: '二小磁力', category: 'magnet' },
  { id: 'dy4k', name: '4K 电影', category: 'magnet' },
  { id: 'dygang', name: '电影港', category: 'magnet' },
  { id: 'leso', name: '乐搜磁力', category: 'magnet' },
  { id: 'gaoqing888', name: '高清 888', category: 'magnet' },
  { id: 'u3c3', name: 'U3C3', category: 'magnet' },
  { id: 'huban', name: '虎斑磁力', category: 'magnet' },
  { id: 'labi', name: '辣比磁力', category: 'magnet' },
  { id: 'shandian', name: '闪电磁力', category: 'magnet' },
  { id: 'zhizhen', name: '指针磁力', category: 'magnet' },
];

/** id -> 元数据 */
export const DISK_PLUGIN_BY_ID: Readonly<Record<string, DiskPluginMeta>> = Object.fromEntries(
  DISK_PLUGINS.map((meta) => [meta.id, meta]),
);

/** 未登记插件的可读名兜底（保持 id 原样） */
export function diskPluginName(id: string): string {
  return DISK_PLUGIN_BY_ID[id]?.name || id;
}

export function diskPluginCategory(id: string): DiskSourceCategory | 'unknown' {
  return DISK_PLUGIN_BY_ID[id]?.category || 'unknown';
}

/** 按注册表把后端返回的插件列表分组；未登记的归入 cloud（原样展示）。 */
export function categorizeDiskPlugins(pluginIds: string[]): {
  cloud: string[];
  magnet: string[];
  needsAccount: string[];
} {
  const cloud: string[] = [];
  const magnet: string[] = [];
  const needsAccount: string[] = [];
  for (const id of pluginIds) {
    const meta = DISK_PLUGIN_BY_ID[id];
    if (meta?.category === 'magnet') magnet.push(id);
    else cloud.push(id);
    if (meta?.needsAccount) needsAccount.push(id);
  }
  return { cloud, magnet, needsAccount };
}

/**
 * TG 频道分组：磁力/电驴频道单独列出，其余归为综合资源频道。
 * 频道名与 pansou CHANNELS 环境变量保持一致。
 */
export const MAGNET_DISK_CHANNELS: ReadonlySet<string> = new Set([
  'cilidianying',
  'ciliziyuanku',
  'cili8888',
]);

export function isMagnetChannel(channel: string): boolean {
  return MAGNET_DISK_CHANNELS.has(channel);
}

/**
 * 跨源去重键：网盘链接按「协议无关的 URL 主体」聚合（host 小写、去尾
 * 斜杠、保留分享参数 s），magnet/ed2k 保留原文小写（btih 唯一）。
 * 提取码不参与键：同一分享可能有的源带提取码、有的不带，合并时由
 * 调用方优先保留带提取码的条目。
 */
export function diskResultDedupeKey(url: string): string {
  const trimmed = (url || '').trim();
  if (/^magnet:/i.test(trimmed) || /^ed2k:/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    const shareKey = parsed.searchParams.get('s') || '';
    return `${parsed.host.toLowerCase()}${path}${shareKey ? `?s=${shareKey}` : ''}`;
  } catch {
    return trimmed.toLowerCase();
  }
}
