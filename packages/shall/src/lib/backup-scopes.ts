// 数据备份/恢复的范围定义（客户端与服务端共享）。

export type BackupScope =
  | 'panel'
  | 'lunatv'
  | 'solara'
  | 'mediago'
  | 'pansou'
  | 'ai-draw'
  | 'tutorial'
  | 'mei-link';

export type BackupMode = 'replace' | 'merge';

export const BACKUP_SCOPES: BackupScope[] = [
  'panel',
  'lunatv',
  'solara',
  'mediago',
  'pansou',
  'ai-draw',
  'tutorial',
  'mei-link',
];

export interface BackupScopeMeta {
  name: string;
  icon: string;
  description: string;
  browserOnly?: boolean;
}

export const BACKUP_SCOPE_META: Record<BackupScope, BackupScopeMeta> = {
  panel: {
    name: '主页',
    icon: 'lucide:layout-dashboard',
    description: '主页设置与主页数据',
  },
  lunatv: {
    name: '影视',
    icon: 'lucide:tv',
    description: '影视设置与影视源',
  },
  solara: {
    name: '音乐',
    icon: 'lucide:music',
    description: '音乐设置、播放列表与收藏',
  },
  mediago: {
    name: '媒体下载',
    icon: 'lucide:download',
    description: '媒体下载设置与下载历史',
  },
  pansou: {
    name: '网盘搜索',
    icon: 'lucide:search',
    description: '网盘搜索配置（浏览器本地）',
    browserOnly: true,
  },
  'ai-draw': {
    name: 'AI 绘图',
    icon: 'lucide:pen-tool',
    description: 'AI 绘图设置与绘图数据',
  },
  tutorial: {
    name: '小说阅读',
    icon: 'lucide:book-open',
    description: '小说站点设置与小说数据',
  },
  'mei-link': {
    name: '内网穿透',
    icon: 'lucide:network',
    description: '隧道服务器设置与隧道配置',
  },
};

// 各应用在浏览器本地持久化的配置键（与同源子路径应用共享 localStorage）。
export const BROWSER_STORAGE_KEYS: Record<BackupScope, string[]> = {
  panel: ['mei-lan-mode', 'mei-enabled', 'mei-recents'],
  lunatv: [
    'defaultAggregateSearch',
    'fluidSearch',
    'enableOptimization',
    'liveDirectConnect',
    'doubanDataSource',
    'doubanProxyUrl',
    'doubanImageProxyType',
    'doubanImageProxyUrl',
    'hasSeenAnnouncement',
  ],
  solara: [
    'mei-music-sources',
    'radarSettings',
    'searchSource',
    'mei-youtube-source-migrated-v1',
    'meiMusicPlaylists.v1',
    'favoriteSongs',
    'meiMusicSelectedList.v1',
    'mei-music-dock-mode',
    'mei-music-dock-last-visible',
    'mei-music-local-state.v1',
  ],
  mediago: ['appstore-storage'],
  pansou: [
    'pansou_channels',
    'pansou_plugins',
    'pansou_disk_types',
    'pansou_custom_channels',
    'pansou_detection_settings',
    'pansou_export_settings',
  ],
  'ai-draw': [],
  tutorial: [],
  'mei-link': [],
};
