// 设置中心 —— 左栏数据源：应用设置 / 运行状态 / 文档与帮助 / 系统设置 四大分组

export interface SettingEntry {
  id: string;
  name: string;
  url: string;
  icon: string;
  action?: 'logout';
}

export interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  entries: SettingEntry[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'apps',
    label: '应用设置',
    icon: 'lucide:layout-grid',
    entries: [
      { id: 'panel-settings', name: '主页设置', url: '/home-editor', icon: 'lucide:layout-dashboard' },
      { id: 'tv-settings', name: '影视设置', url: '/settings/tv', icon: 'lucide:tv' },
      { id: 'solara-settings', name: '音乐播放设置', url: '/settings/solara', icon: 'lucide:music' },
      { id: 'mediago-settings', name: '媒体下载设置', url: '/settings/mediago', icon: 'lucide:download' },
      { id: 'pansou-config', name: '网盘搜索设置', url: '/settings/pansou', icon: 'lucide:search' },
      { id: 'draw-settings', name: 'AI 绘图设置', url: '/settings/ai-draw', icon: 'lucide:pen-tool' },
      { id: 'novels-manage', name: '小说站点管理', url: '/novels/manage', icon: 'lucide:book-open' },
      { id: 'novels-backup', name: '小说阅读数据备份', url: '/novels/backup', icon: 'lucide:database' },
      { id: 'link-server', name: '隧道服务器设置', url: '/settings/link-server', icon: 'lucide:server' },
    ],
  },
  {
    id: 'runtime',
    label: '运行状态',
    icon: 'lucide:activity',
    entries: [
      { id: 'link-logs', name: '隧道运行日志', url: '/settings/link-logs', icon: 'lucide:scroll-text' },
      { id: 'draw-status', name: '绘图运行状态', url: '/settings/ai-draw-status', icon: 'lucide:bar-chart' },
    ],
  },
  {
    id: 'docs',
    label: '文档与帮助',
    icon: 'lucide:book-open',
    entries: [
      { id: 'help', name: '帮助中心', url: '/settings/help', icon: 'lucide:life-buoy' },
    ],
  },
  {
    id: 'system',
    label: '系统设置',
    icon: 'lucide:settings',
    entries: [
      { id: 'account', name: '账号与安全', url: '/settings/account', icon: 'lucide:user-cog' },
      { id: 'logout', name: '退出登录', url: '#logout', icon: 'lucide:log-out', action: 'logout' },
    ],
  },
];

// 帮助中心内部的应用文档导航；不再把每个文档都挂到设置左栏。
export const HELP_DOC_ENTRIES = [
  { id: 'portal', name: '门户使用指南', icon: 'lucide:home' },
  { id: 'lunatv', name: '影视门户帮助', icon: 'lucide:tv' },
  { id: 'solara', name: '音乐播放帮助', icon: 'lucide:music' },
  { id: 'mediago', name: '媒体下载帮助', icon: 'lucide:download' },
  { id: 'pansou', name: '网盘搜索与 API', icon: 'lucide:search' },
  { id: 'ai-draw', name: 'AI 绘图使用手册', icon: 'lucide:pen-tool' },
  { id: 'tutorial', name: '小说阅读帮助', icon: 'lucide:book-open' },
  { id: 'mei-link', name: '内网穿透帮助', icon: 'lucide:network' },
  { id: 'omni-tools', name: '工具箱帮助', icon: 'lucide:wrench' },
];
