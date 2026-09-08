/**
 * 首页网页搜索引擎管理（纯逻辑，供 PortalClient / home-editor / panel-store 共用）：
 * - 引擎 = { id, name, url }，url 为搜索链接模板，{q} 占位关键词
 * - 内置四个种子引擎；用户自定义列表存 panel.style.searchEngines（未自定义时回落种子）
 * - 默认引擎 = panel.style.searchEngine（首页框内切换引擎即改此字段，与设置页「设为默认」同源）
 */
export interface ManagedSearchEngine {
  id: string;
  name: string;
  url: string; // 搜索链接模板，{q} 占位关键词
}

export const BUILTIN_SEARCH_ENGINES: ManagedSearchEngine[] = [
  { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q={q}' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={q}' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={q}' },
  { id: 'duckduckgo', name: 'Duck', url: 'https://duckduckgo.com/?q={q}' },
];

export const MAX_SEARCH_ENGINES = 16;

/** 引擎模板归一：缺 {q} 占位时追加在末尾（兼容 `...?q=` 结尾与裸域名写法） */
export function normalizeEngineUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /\{q\}/.test(t) ? t : t + '{q}';
}

/** 生成搜索跳转链接：{q} → encodeURIComponent 关键词 */
export function buildEngineSearchUrl(engine: ManagedSearchEngine, q: string): string {
  return engine.url.replace(/\{q\}/g, encodeURIComponent(q.trim()));
}

/**
 * 清洗用户管理的引擎列表：过滤非法项（缺名称 / 非 http(s) 链接）、截断数量、归一模板、去重 id。
 * 内置 id（bing/google/baidu/duckduckgo）名称强制对齐种子（历史物化数据可能是旧长名，窄下拉会截断）。
 * 存储前（panel-store）与展示前（设置页）共用，保证落盘数据总是合法。
 */
export function normalizeSearchEngines(raw: unknown): ManagedSearchEngine[] {
  const list = (Array.isArray(raw) ? raw : []).slice(0, MAX_SEARCH_ENGINES);
  const seen = new Set<string>();
  const out: ManagedSearchEngine[] = [];
  const seedNameById = new Map(BUILTIN_SEARCH_ENGINES.map((e) => [e.id, e.name]));
  for (const item of list) {
    const it = (item || {}) as Record<string, unknown>;
    const rawName = typeof it.name === 'string' ? it.name.trim().slice(0, 24) : '';
    const rawUrl = typeof it.url === 'string' ? it.url.trim().slice(0, 2000) : '';
    if (!rawName || !/^https?:\/\//i.test(rawUrl)) continue;
    let id =
      typeof it.id === 'string' && it.id.trim()
        ? it.id.trim().slice(0, 40)
        : `ce${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    while (seen.has(id)) id = `${id.slice(0, 34)}${Math.random().toString(36).slice(2, 6)}`;
    seen.add(id);
    out.push({ id, name: seedNameById.get(id) || rawName, url: normalizeEngineUrl(rawUrl) });
  }
  return out;
}

/** 有效引擎列表：面板未配置（历史数据）或全非法时回落内置种子 */
export function resolveSearchEngines(
  style: { searchEngines?: ManagedSearchEngine[] } | undefined | null
): ManagedSearchEngine[] {
  const list = Array.isArray(style?.searchEngines) ? style!.searchEngines! : [];
  const valid = list.filter((e) => e && e.id && e.name && /^https?:\/\//i.test(e.url));
  return valid.length > 0 ? valid : BUILTIN_SEARCH_ENGINES;
}

/** 默认引擎 id：面板记录值必须在有效列表内，否则回落第一个 */
export function resolveDefaultEngineId(
  style: { searchEngine?: string } | undefined | null,
  engines: ManagedSearchEngine[]
): string {
  const saved = typeof style?.searchEngine === 'string' ? style.searchEngine : '';
  return engines.some((e) => e.id === saved) ? saved : engines[0]?.id || '';
}
