// 主页面板配置（/data/shell/panel.json）—— 全量复刻 Sun-Panel 能力
// 风格（Logo/时钟/搜索/图标样式/背景/边距/页脚）+ 分组 + 图标项（双地址/图标图片）+ 系统监控开关
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const PANEL_FILE = path.join(DATA_DIR, 'shell', 'panel.json');

export interface PanelBackground {
  url: string; // 空 = 默认极光；支持 http(s):// 与 data:image/*
  mask: number; // 遮罩不透明度 0~0.9
  blur: number; // 模糊 px
}

export interface PanelStyle {
  logoText: string; // Logo 文字（空则不显示）
  logoImage: string; // Logo 图片（URL/base64，优先于文字）
  clockShowSecond: boolean;
  searchBoxShow: boolean;
  searchEngine: 'bing' | 'google' | 'baidu' | 'duckduckgo';
  iconStyle: 'icon' | 'info'; // icon=纯图标 info=图标+标题+描述
  iconTextColor: string; // 图标文字颜色（壁纸场景可调白）
  themeMode: 'light' | 'dark'; // 首页主色调：深色背景用 dark（文字浅色），浅色背景用 light
  marginTop: number; // %
  marginBottom: number; // %
  marginX: number; // px
  maxWidth: number; // px
  footerHtml: string; // 自定义页脚 HTML（默认空）
  systemMonitorShow: boolean;
}

export interface PanelGroup {
  id: string;
  name: string;
  iconStyle?: 'icon' | 'info';
  iconColor?: string;
}

export interface PanelItem {
  id: string;
  groupId: string; // 空串 = 未分组
  title: string;
  description: string;
  url: string;
  lanUrl: string; // 内网地址（内网模式优先）
  icon: string; // lucide:xxx | text:xxx（文字图标）| http(s)/data:image（图片）
  iconColor: string; // 图标块底色（空 = 默认渐变/灰蓝）
  builtin?: string; // 关联的插件 id（内置应用物化；保留健康检查/开关关联）
}

export interface PanelConfig {
  background: PanelBackground;
  style: PanelStyle;
  groups: PanelGroup[];
  items: PanelItem[]; // 全部图标项（内置应用物化 + 自定义项）
  removedBuiltin: string[]; // 用户删除过的内置应用 plugin id（同步时跳过）
}

export const DEFAULT_CONFIG: PanelConfig = {
  background: { url: '', mask: 0.35, blur: 0 },
  style: {
    logoText: 'Mei-Allin',
    logoImage: '',
    clockShowSecond: true,
    searchBoxShow: true,
    searchEngine: 'bing',
    iconStyle: 'info',
    iconTextColor: '',
    themeMode: 'light',
    marginTop: 4,
    marginBottom: 6,
    marginX: 0,
    maxWidth: 1180,
    footerHtml: '',
    systemMonitorShow: false,
  },
  groups: [],
  items: [],
  removedBuiltin: [],
};

function clampNum(v: unknown, min: number, max: number, dft: number): number {
  const n = Number(v);
  if (!isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, maxLen: number, dft = ''): string {
  if (typeof v !== 'string') return dft;
  return v.slice(0, maxLen);
}

export function normalizeConfig(raw: unknown): PanelConfig {
  const r = (raw || {}) as Record<string, unknown>;
  const bg = (r.background || {}) as Record<string, unknown>;
  const st = (r.style || {}) as Record<string, unknown>;
  const engine = ['bing', 'google', 'baidu', 'duckduckgo'].includes(String(st.searchEngine))
    ? (st.searchEngine as PanelStyle['searchEngine'])
    : 'bing';
  const groups = (Array.isArray(r.groups) ? r.groups : [])
    .filter((g) => g && g.name)
    .slice(0, 24)
    .map((g, i) => ({ id: str(g.id, 40, `g${Date.now()}-${i}`), name: str(g.name, 24), iconStyle: ['icon', 'info'].includes(String(g.iconStyle)) ? g.iconStyle as 'icon' | 'info' : undefined, iconColor: /^#[0-9a-fA-F]{3,8}$/.test(String(g.iconColor)) ? String(g.iconColor) : '' }));
  // 兼容历史数据：groupId 可能存的是分组“名称”（老版本按名称匹配后未转换成 id，
  // 导致首页分组渲染全部落到「常用」），这里统一映射回分组 id
  const resolveGroupId = (gid: string): string => {
    if (!gid) return '';
    if (groups.some((g) => g.id === gid)) return gid;
    const byName = groups.find((g) => g.name === gid);
    return byName ? byName.id : gid;
  };
  return {
    background: {
      url: str(bg.url, 40 * 1024 * 1024),
      mask: clampNum(bg.mask, 0, 0.9, 0.35),
      blur: clampNum(bg.blur, 0, 24, 0),
    },
    style: {
      logoText: str(st.logoText, 40, 'Mei-Allin'),
      logoImage: str(st.logoImage, 40 * 1024 * 1024),
      clockShowSecond: st.clockShowSecond !== false,
      searchBoxShow: st.searchBoxShow !== false,
      searchEngine: engine,
      iconStyle: st.iconStyle === 'icon' ? 'icon' : 'info',
      iconTextColor: /^#[0-9a-fA-F]{3,8}$/.test(String(st.iconTextColor)) ? String(st.iconTextColor) : '',
      themeMode: st.themeMode === 'dark' ? 'dark' : 'light',
      marginTop: clampNum(st.marginTop, 0, 40, 4),
      marginBottom: clampNum(st.marginBottom, 0, 40, 6),
      marginX: clampNum(st.marginX, 0, 120, 0),
      maxWidth: clampNum(st.maxWidth, 600, 2400, 1180),
      footerHtml: str(st.footerHtml, 8000),
      systemMonitorShow: st.systemMonitorShow === true,
    },
    groups,
    items: (Array.isArray(r.items) ? r.items : [])
      .filter((i) => i && i.title && i.url)
      .slice(0, 300)
      .map((i, idx) => ({
        id: str(i.id, 40, `c${Date.now()}-${idx}`),
        groupId: resolveGroupId(str(i.groupId, 40)),
        title: str(i.title, 30),
        description: str(i.description, 80),
        url: str(i.url, 40 * 1024 * 1024),
        lanUrl: str(i.lanUrl, 40 * 1024 * 1024),
        icon: str(i.icon, 40 * 1024 * 1024, 'lucide:link'),
        iconColor: /^#[0-9a-fA-F]{3,8}$/.test(String(i.iconColor)) ? String(i.iconColor) : '',
        ...(i.builtin ? { builtin: str(i.builtin, 60) } : {}),
      })),
    removedBuiltin: (Array.isArray(r.removedBuiltin) ? r.removedBuiltin : [])
      .map((x) => str(x, 60))
      .filter(Boolean)
      .slice(0, 200),
  };
}

/**
 * 同步内置应用到 items（物化）：
 * - 新增的内置应用（含书架展开实例）自动添加为图标项
 * - 已从系统移除的内置应用（plugins 中消失）自动删除对应项
 * - 已存在的项不做任何覆盖（完全归用户管理：可编辑/排序/换组）
 * - removedBuiltin 黑名单内的不同步（用户删除过的不再复活）
 */
export function syncBuiltinItems(
  config: PanelConfig,
  plugins: Array<{ id: string; name: string; description?: string; icon: string; url: string }>
): { config: PanelConfig; changed: boolean } {
  const removed = new Set(config.removedBuiltin);
  const pluginIds = new Set(plugins.map((p) => p.id));
  const existingBuiltin = new Set(config.items.filter((i) => i.builtin).map((i) => i.builtin as string));
  let changed = false;
  let items = config.items.filter((i) => {
    if (i.builtin && !pluginIds.has(i.builtin)) { changed = true; return false; }
    return true;
  });
  for (const p of plugins) {
    if (removed.has(p.id) || existingBuiltin.has(p.id)) continue;
    items.push({
      id: `b-${p.id}`,
      groupId: '',
      title: p.name,
      description: p.description || '',
      url: p.url,
      lanUrl: '',
      icon: p.icon,
      iconColor: '',
      builtin: p.id,
    });
    changed = true;
  }
  return changed ? { config: { ...config, items }, changed } : { config, changed };
}

export function getPanelConfig(): PanelConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
    // 兼容旧版（customItems → items）
    if (raw && Array.isArray(raw.customItems) && !Array.isArray(raw.items)) {
      raw.items = raw.customItems.map((c: { id?: string; name?: string; url?: string; icon?: string }) => ({
        id: c.id,
        groupId: '',
        title: c.name,
        description: '',
        url: c.url,
        lanUrl: '',
        icon: c.icon,
      }));
      delete raw.customItems;
    }
    return normalizeConfig(raw);
  } catch {
    return normalizeConfig(null);
  }
}

export function savePanelConfig(config: PanelConfig): void {
  fs.mkdirSync(path.dirname(PANEL_FILE), { recursive: true });
  fs.writeFileSync(PANEL_FILE, JSON.stringify(normalizeConfig(config), null, 2));
}
