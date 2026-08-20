// 设置中心 —— 左栏数据源：应用设置 / 文档与帮助 / 系统设置 三大分组
// 全部原生化：入口为直达链接（不再 iframe 内嵌）

export interface SettingEntry {
  id: string;
  name: string;
  url: string; // 直达原生页面；action='logout' 时为弹层动作
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
      { id: 'tv-settings', name: '影视设置', url: '/tv/mei-settings', icon: 'lucide:tv' },
      { id: 'tv-sources', name: '影视源管理', url: '/tv/mei-sources', icon: 'lucide:database' },
      { id: 'solara-settings', name: '音乐播放设置', url: '/music/?meiSettings=1', icon: 'lucide:music' },
      { id: 'mediago-settings', name: '媒体下载设置', url: '/media/settings', icon: 'lucide:download' },
      { id: 'pansou-config', name: '网盘搜索设置', url: '/search/?view=config', icon: 'lucide:search' },
      { id: 'draw-settings', name: 'AI 绘图设置', url: '/draw/profile', icon: 'lucide:pen-tool' },
      { id: 'novels-manage', name: '小说站点管理', url: '/novels/manage', icon: 'lucide:book-open' },
      { id: 'novels-backup', name: '站点数据备份', url: '/novels/backup', icon: 'lucide:database' },
      { id: 'link-server', name: '隧道服务器设置', url: '/link/?meiView=settings', icon: 'lucide:server' },
      { id: 'link-logs', name: '隧道运行日志', url: '/link/?meiView=logs', icon: 'lucide:scroll-text' },
    ],
  },
  {
    id: 'docs',
    label: '文档与帮助',
    icon: 'lucide:book-open',
    entries: [
      { id: 'help-portal', name: '门户使用指南', url: '/settings/help/portal', icon: 'lucide:home' },
      { id: 'help-tv', name: '影视门户帮助', url: '/settings/help/lunatv', icon: 'lucide:tv' },
      { id: 'help-music', name: '音乐播放帮助', url: '/settings/help/solara', icon: 'lucide:music' },
      { id: 'help-media', name: '媒体下载帮助', url: '/settings/help/mediago', icon: 'lucide:download' },
      { id: 'help-pansou', name: '网盘搜索与 API', url: '/settings/help/pansou', icon: 'lucide:search' },
      { id: 'help-draw', name: 'AI 绘图使用手册', url: '/settings/help/ai-draw', icon: 'lucide:pen-tool' },
      { id: 'help-novels', name: '小说阅读帮助', url: '/settings/help/tutorial', icon: 'lucide:book-open' },
      { id: 'help-link', name: '内网穿透帮助', url: '/settings/help/mei-link', icon: 'lucide:network' },
      { id: 'help-tools', name: '工具箱帮助', url: '/settings/help/omni-tools', icon: 'lucide:wrench' },
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
