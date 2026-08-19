// 主页面板配置（/data/shell/panel.json）—— 背景 + 自定义应用/链接
// mei-allin 自研主页（吸收 SunPanel 方案），管理入口在设置集成页「主页设置」
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const PANEL_FILE = path.join(DATA_DIR, 'shell', 'panel.json');

export interface PanelBackground {
  url: string; // 空 = 默认极光
  mask: number; // 遮罩不透明度 0~0.9
  blur: number; // 模糊 px
}

export interface CustomItem {
  id: string;
  name: string;
  url: string;
  icon: string; // MeiIcon 名（lucide:xxx）
}

export interface PanelConfig {
  background: PanelBackground;
  customItems: CustomItem[];
}

const DEFAULT_CONFIG: PanelConfig = {
  background: { url: '', mask: 0.35, blur: 0 },
  customItems: [],
};

export function getPanelConfig(): PanelConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
    return {
      background: { ...DEFAULT_CONFIG.background, ...(raw.background || {}) },
      customItems: Array.isArray(raw.customItems) ? raw.customItems : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG, background: { ...DEFAULT_CONFIG.background } };
  }
}

export function savePanelConfig(config: PanelConfig): void {
  fs.mkdirSync(path.dirname(PANEL_FILE), { recursive: true });
  fs.writeFileSync(PANEL_FILE, JSON.stringify(config, null, 2));
}
