// 应用集成开关（纯本地 localStorage，仅影响当前浏览器可见性）
// 默认全部开启；关闭后门户卡片置灰、顶栏该应用入口保留但置灰。

export interface SwitchableApp {
  id: string;
  name: string;
  icon: string;
}

// 可开关的应用（与 image/plugins.json 中的 id 对应）
export const SWITCHABLE_APPS: SwitchableApp[] = [
  { id: 'ai-draw', name: 'AI 绘图', icon: 'lucide:pen-tool' },
  { id: 'sun-panel', name: '主页面板', icon: 'lucide:layout-dashboard' },
  { id: 'solara', name: '音乐播放', icon: 'lucide:music' },
  { id: 'lunatv', name: '影视门户', icon: 'lucide:tv' },
  { id: 'mediago', name: '流媒体下载', icon: 'lucide:download' },
];

const STORAGE_KEY = 'mei-enabled';

export function isSwitchable(id: string): boolean {
  return SWITCHABLE_APPS.some((a) => a.id === id);
}

// 读取某个应用是否启用（缺省视为启用）
export function isAppEnabled(id: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[id] !== false;
  } catch {
    return true;
  }
}

// 读取全部启用状态（仅含可开关应用）
export function readEnabledMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function writeEnabled(id: string, enabled: boolean) {
  const map = readEnabledMap();
  map[id] = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}
