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
}

export interface PanelItem {
  id: string;
  groupId: string; // 空串 = 未分组
  title: string;
  description: string;
  url: string;
  lanUrl: string; // 内网地址（内网模式优先）
  icon: string; // lucide:xxx 或 http(s)/data:image（图片）
}

export interface PanelConfig {
  background: PanelBackground;
  style: PanelStyle;
  groups: PanelGroup[];
  items: PanelItem[]; // 自定义项（内置应用由系统自动渲染）
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
    marginTop: 4,
    marginBottom: 6,
    marginX: 0,
    maxWidth: 1180,
    footerHtml: '',
    systemMonitorShow: false,
  },
  groups: [],
  items: [],
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
      marginTop: clampNum(st.marginTop, 0, 40, 4),
      marginBottom: clampNum(st.marginBottom, 0, 40, 6),
      marginX: clampNum(st.marginX, 0, 120, 0),
      maxWidth: clampNum(st.maxWidth, 600, 2400, 1180),
      footerHtml: str(st.footerHtml, 8000),
      systemMonitorShow: st.systemMonitorShow === true,
    },
    groups: (Array.isArray(r.groups) ? r.groups : [])
      .filter((g) => g && g.name)
      .slice(0, 24)
      .map((g, i) => ({ id: str(g.id, 40, `g${Date.now()}-${i}`), name: str(g.name, 24) })),
    items: (Array.isArray(r.items) ? r.items : [])
      .filter((i) => i && i.title && i.url)
      .slice(0, 200)
      .map((i, idx) => ({
        id: str(i.id, 40, `c${Date.now()}-${idx}`),
        groupId: str(i.groupId, 40),
        title: str(i.title, 30),
        description: str(i.description, 80),
        url: str(i.url, 40 * 1024 * 1024),
        lanUrl: str(i.lanUrl, 40 * 1024 * 1024),
        icon: str(i.icon, 40 * 1024 * 1024, 'lucide:link'),
      })),
  };
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
