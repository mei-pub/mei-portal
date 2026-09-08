/**
 * 首页搜索框模式（纯逻辑，供 PortalClient 与单测共用）：
 * - web：网页搜索（默认，Enter 跳外部引擎，行为与历史版本一致）
 * - all：综合搜索（Enter 客户端路由跳 /search 聚合页，等同顶栏搜索框 scope=all）
 * 模式选择持久化在 localStorage，未配置 / 值非法时一律回落 web。
 */
export type HomeSearchMode = 'all' | 'web';

export const HOME_SEARCH_MODE_KEY = 'mei-home-search-mode';

/** 综合搜索筛选范围：与顶栏搜索框 / 搜索结果页 scope 一致 */
export const SEARCH_SCOPES: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'tv', label: '影视' },
  { id: 'music', label: '音乐' },
  { id: 'disks', label: '网盘' },
  { id: 'draw', label: 'AI 绘图' },
  { id: 'tools', label: '工具箱' },
  { id: 'novels', label: '小说' },
];

export const HOME_SEARCH_SCOPE_KEY = 'mei-home-search-scope';

export function parseHomeSearchScope(raw: string | null | undefined): string {
  return SEARCH_SCOPES.some((s) => s.id === raw) ? (raw as string) : 'all';
}

export function parseHomeSearchMode(raw: string | null | undefined): HomeSearchMode {
  return raw === 'all' ? 'all' : 'web';
}

/** 综合搜索目标路径：与顶栏搜索框提交的 /search?q=&scope= 完全一致 */
export function homeSearchTarget(q: string, scope = 'all'): string {
  return `/search?${new URLSearchParams({ q, scope }).toString()}`;
}
