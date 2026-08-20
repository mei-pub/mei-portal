// 设置集成页 —— 左栏数据源：按系统分组，挂载各子应用的设置入口
// url 为同源子路径深链，统一带 ?meiEmbed=1 使 nginx 不注入门户顶栏

export interface SettingEntry {
  id: string;
  name: string;
  url: string;
  icon: string;
}

export interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  entries: SettingEntry[];
}

// 分组顺序：主页面板 → 影视门户 → 音乐播放 → 媒体下载 → 网盘搜索 → AI 绘图 → 小说阅读 → 内网穿透
export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'sun-panel',
    label: '主页面板',
    icon: 'lucide:layout-dashboard',
    entries: [
      { id: 'panel-settings', name: '主页设置', url: '/home-editor?meiEmbed=1', icon: 'lucide:settings-2' },
    ],
  },
  {
    id: 'lunatv',
    label: '影视门户',
    icon: 'lucide:tv',
    entries: [
      { id: 'tv-settings', name: '影视设置', url: '/tv/mei-settings?meiEmbed=1', icon: 'lucide:settings-2' },
      { id: 'tv-sources', name: '影视源管理', url: '/tv/mei-sources?meiEmbed=1', icon: 'lucide:database' },
    ],
  },
  {
    id: 'solara',
    label: '音乐播放',
    icon: 'lucide:music',
    entries: [
      { id: 'solara-settings', name: '音乐播放器设置', url: '/music/?meiSettings=1&meiEmbed=1', icon: 'lucide:settings-2' },
    ],
  },
  {
    id: 'mediago',
    label: '媒体下载',
    icon: 'lucide:download',
    entries: [
      { id: 'mediago-settings', name: '媒体下载设置', url: '/media/settings?meiEmbed=1', icon: 'lucide:settings-2' },
    ],
  },
  {
    id: 'pansou',
    label: '网盘搜索',
    icon: 'lucide:search',
    entries: [
      { id: 'pansou-config', name: '网盘搜索设置', url: '/search/?view=config&meiEmbed=1', icon: 'lucide:settings-2' },
      { id: 'pansou-api', name: '网盘搜 API', url: '/search/?view=api&meiEmbed=1', icon: 'lucide:plug' },
    ],
  },
  {
    id: 'ai-draw',
    label: 'AI 绘图',
    icon: 'lucide:pen-tool',
    entries: [
      { id: 'draw-profile', name: '绘图个人设置', url: '/draw/profile?meiEmbed=1', icon: 'lucide:user' },
      { id: 'draw-admin', name: '绘图系统设置', url: '/draw/admin?meiEmbed=1', icon: 'lucide:shield' },
      { id: 'draw-manual', name: '绘图使用手册', url: '/draw/docs/manual?meiEmbed=1', icon: 'lucide:book-open' },
    ],
  },
  {
    id: 'tutorial',
    label: '小说阅读',
    icon: 'lucide:book-open',
    entries: [
      { id: 'novels-manage', name: '小说站点管理', url: '/novels/manage?meiEmbed=1', icon: 'lucide:library' },
      { id: 'novels-backup', name: '数据备份', url: '/novels/backup?meiEmbed=1', icon: 'lucide:database' },
    ],
  },
  {
    id: 'mei-link',
    label: '内网穿透',
    icon: 'lucide:network',
    entries: [
      { id: 'link-server', name: '隧道服务器设置', url: '/link/?meiView=settings&meiEmbed=1', icon: 'lucide:server' },
      { id: 'link-logs', name: '隧道运行日志', url: '/link/?meiView=logs&meiEmbed=1', icon: 'lucide:scroll-text' },
    ],
  },
];
