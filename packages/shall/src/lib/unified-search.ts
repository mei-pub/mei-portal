import fs from 'node:fs';
import path from 'node:path';

import { diskResultDedupeKey, DISK_PLUGIN_BY_ID } from './disk-sources.ts';

// getSessionTokens is imported lazily (inside the function) to avoid loading
// next/headers (which is not available in the Node test runner) at module level.
let _getSessionTokens: () => Record<string, string> = () => ({});

/** Inject the real token getter (called from the API route, which runs in Next.js) */
export function _bindGetSessionTokens(fn: () => Record<string, string>): void {
  _getSessionTokens = fn;
}

export type SearchScope = 'all' | 'tv' | 'music' | 'disks' | 'draw' | 'tools' | 'novels';
export type SearchProviderApp = Exclude<SearchScope, 'all'>;

export interface UnifiedSearchResult {
  id: string;
  appId: string;
  kind: 'video' | 'song' | 'diskLink' | 'drawing' | 'tool' | 'novel';
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  score?: number;
  source?: { id: string; name: string };
  meta?: Record<string, unknown>;
  action:
    | { type: 'open'; href: string }
    | { type: 'play'; href: string; payload: unknown }
    | { type: 'external'; href: string };
}

export interface SearchFacet {
  key: string;
  label: string;
  count: number;
}

export interface SearchGroup {
  appId: string;
  label: string;
  status: 'ok' | 'empty' | 'error' | 'timeout';
  total: number;
  latencyMs?: number;
  error?: string;
  results: UnifiedSearchResult[];
  hasMore: boolean;
  /** Per-dimension counts over the provider's full result set (disks: cloud type). */
  facets?: SearchFacet[];
}

const SCOPES = new Set<SearchScope>(['all', 'tv', 'music', 'disks', 'draw', 'tools', 'novels']);

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(value)));
}

export function parseSearchQuery(params: URLSearchParams): {
  query: string;
  scope: SearchScope;
  limit: number;
  offset: number;
} {
  const scope = (params.get('scope') || 'all') as SearchScope;
  const limit = Number(params.get('limit') || 20);
  const offset = Number(params.get('offset') || 0);
  return {
    query: (params.get('q') || '').trim(),
    scope: SCOPES.has(scope) ? scope : 'all',
    limit: clampLimit(limit),
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
  };
}

export function providerEnabled(scope: SearchScope, app: SearchProviderApp): boolean {
  return scope === 'all' || scope === app;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, '');
}

/** Keep broad upstream TV matches out of the portal when the title is unrelated. */
export function matchesVideoQuery(title: string, query: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedTitle || !normalizedQuery) return false;
  if (normalizedTitle.includes(normalizedQuery)) return true;

  const tokens = query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}\u3400-\u9fff]+/gu)
    .map(normalizeSearchText)
    .filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => normalizedTitle.includes(token));
}

export function normalizeVideoResult(raw: unknown): UnifiedSearchResult {
  const item = (raw || {}) as Record<string, unknown>;
  const id = text(item.id);
  const source = text(item.source);
  const title = text(item.title) || '未命名影视';
  const year = text(item.year);
  return {
    id: `${source}:${id}`,
    appId: 'lunatv',
    kind: 'video',
    title,
    subtitle: [year, text(item.type_name)].filter(Boolean).join(' · '),
    image: text(item.poster),
    source: { id: source, name: text(item.source_name) || source },
    meta: { year: item.year, typeName: item.type_name, episodes: item.episodes },
    action: {
      type: 'open',
      href: `/tv/play/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
    },
  };
}

export function normalizeMusicResult(raw: unknown): UnifiedSearchResult {
  const item = (raw || {}) as Record<string, unknown>;
  const id = text(item.id);
  const source = text(item.source) || 'netease';
  const title = text(item.name) || '未命名歌曲';
  const picId = text(item.pic_id);
  return {
    id: `${source}:${id}`,
    appId: 'solara',
    kind: 'song',
    title,
    subtitle: text(item.artist) || '未知艺术家',
    description: text(item.album),
    // Do not expose the protected Solara proxy directly to the browser. The
    // portal cover route adds the service cookie and works behind the public
    // reverse proxy as well as locally.
    image: picId ? `/api/search/cover/${encodeURIComponent(source)}/${encodeURIComponent(picId)}` : undefined,
    source: { id: source, name: source },
    meta: { album: item.album, artist: item.artist, picId },
    action: { type: 'play', href: '/music/player', payload: item },
  };
}

/** Well-known pansou source ids -> readable names (verified from upstream plugin docs). */
const DISK_SOURCE_NAMES: Record<string, string> = {
  jutoushe: '剧透社',
  clmao: '磁力猫',
  ciligou: '磁力狗',
  wuji: '无极磁链',
  xb6v: '6v电影',
  libvio: 'LIBVIO',
  xiaozhang: '校长影视',
  leijing: '雷鲸小站',
  muou: '木偶',
  yunsou: '云搜',
  xdpan: '兄弟盘',
  dygod: '电影天堂',
  cldi: '磁力帝',
  btbtlb: 'BT影视',
  pansearch: '盘搜',
};

/** Backend merged_by_type keys -> readable cloud brand (display only, real field wins). */
const DISK_TYPE_NAMES: Record<string, string> = {
  quark: '夸克网盘',
  uc: 'UC网盘',
  baidu: '百度网盘',
  aliyun: '阿里云盘',
  alipan: '阿里云盘',
  ali: '阿里云盘',
  tianyi: '天翼云盘',
  cloud189: '天翼云盘',
  xunlei: '迅雷云盘',
  mobile: '移动云盘',
  caiyun: '移动云盘',
  '139': '移动云盘',
  '115': '115网盘',
  '123': '123云盘',
  '123pan': '123云盘',
  weiyun: '腾讯微云',
  lanzou: '蓝奏云',
  magnet: '磁力链接',
  ed2k: '电驴链接',
};

/** Deterministic URL host -> brand, only consulted when the backend type key is missing. */
const DISK_HOST_NAMES: Array<[RegExp, string]> = [
  [/pan\.quark\.cn/i, '夸克网盘'],
  [/pan\.baidu\.com/i, '百度网盘'],
  [/alipan\.com|aliyundrive\.com/i, '阿里云盘'],
  [/cloud\.189\.cn/i, '天翼云盘'],
  [/pan\.xunlei\.com/i, '迅雷云盘'],
  [/caiyun\.139\.com|yun\.139\.com/i, '移动云盘'],
  [/(^|\.)115\.com|115cdn\.com/i, '115网盘'],
  [/pan\.uc\.cn/i, 'UC网盘'],
  [/weiyun\.com/i, '腾讯微云'],
  [/123pan\.\w+|123684\.com|123865\.com|123912\.com/i, '123云盘'],
  [/lanzou|lanzn\.com/i, '蓝奏云'],
  [/jianguoyun\.com/i, '坚果云'],
  [/mega\.nz/i, 'MEGA'],
];

function diskSourceName(raw: string): string {
  const bare = raw.replace(/^(plugin|tg):/i, '').trim();
  if (!bare) return raw || '未知来源';
  const id = bare.toLowerCase();
  // Registry is the source of truth; the table above only covers legacy ids.
  const registered = DISK_PLUGIN_BY_ID[id]?.name;
  return registered || DISK_SOURCE_NAMES[id] || bare;
}

/** Short tab labels for cloud types, mirroring the pansou app's filter tabs. */
const DISK_TYPE_TAB_ORDER = [
  'baidu', 'magnet', 'quark', 'aliyun', 'tianyi', 'uc', 'xunlei',
  'mobile', '115', '123', 'weiyun', 'lanzou', 'ed2k',
];
const DISK_TYPE_TAB_LABELS: Record<string, string> = {
  baidu: '百度',
  quark: '夸克',
  aliyun: '阿里',
  alipan: '阿里',
  ali: '阿里',
  tianyi: '天翼',
  cloud189: '天翼',
  uc: 'UC',
  xunlei: '迅雷',
  mobile: '移动',
  caiyun: '移动',
  '139': '移动',
  '115': '115',
  '123': '123',
  '123pan': '123',
  weiyun: '微云',
  lanzou: '蓝奏',
  magnet: '磁力',
  ed2k: '电驴',
};

/** Order and label per-type counts into facet tabs; unknown types go last. */
export function buildDiskFacets(counts: Record<string, number>): SearchFacet[] {
  const keys = Object.keys(counts).filter((key) => counts[key] > 0);
  const ordered = [
    ...DISK_TYPE_TAB_ORDER.filter((key) => keys.includes(key)),
    ...keys
      .filter((key) => !DISK_TYPE_TAB_ORDER.includes(key) && key !== 'unknown')
      .sort(),
    ...(keys.includes('unknown') ? ['unknown'] : []),
  ];
  return ordered.map((key) => ({
    key,
    label: DISK_TYPE_TAB_LABELS[key] || (key === 'unknown' ? '其他' : key),
    count: counts[key],
  }));
}

function diskTypeName(diskType: string, linkType: string, url: string): string {
  const key = diskType.trim().toLowerCase();
  if (DISK_TYPE_NAMES[key]) return DISK_TYPE_NAMES[key];
  if (linkType === 'magnet' || linkType === 'ed2k') {
    return linkType === 'magnet' ? '磁力链接' : '电驴链接';
  }
  for (const [pattern, name] of DISK_HOST_NAMES) {
    if (pattern.test(url)) return name;
  }
  return '网盘链接';
}

/** Format backend datetime as YYYY-MM-DD in the portal timezone; hide zero/invalid values. */
function formatDiskDate(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return '';
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  if (date.getUTCFullYear() < 2000) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function normalizeDiskResult(raw: unknown, diskTypeHint?: string): UnifiedSearchResult {
  const item = (raw || {}) as Record<string, unknown>;
  const url = text(item.url);
  const source = text(item.source) || 'unknown';
  const diskType = text(diskTypeHint) || text(item.type) || inferDiskType(url);
  const linkType = diskType === 'magnet' || /^magnet:/i.test(url)
    ? 'magnet'
    : diskType === 'ed2k' || /^ed2k:/i.test(url)
      ? 'ed2k'
      : 'pan';
  const linkTypeLabel = diskTypeName(diskType, linkType, url);
  const sourceName = diskSourceName(source);
  const title = text(item.note) || url || '未命名网盘资源';
  return {
    id: `${source}:${url || title}`,
    appId: 'pansou',
    kind: 'diskLink',
    title,
    subtitle: sourceName,
    description: formatDiskDate(item.datetime),
    source: { id: source, name: sourceName },
    meta: { url, password: item.password, datetime: item.datetime, diskType, linkType, linkTypeLabel },
    action: { type: 'external', href: url || '#' },
  };
}

function inferDiskType(url: string): string {
  if (/^magnet:/i.test(url)) return 'magnet';
  if (/^ed2k:/i.test(url)) return 'ed2k';
  return 'unknown';
}

export function normalizeNovelResult(
  raw: unknown,
  site: { slug: string; name: string }
): UnifiedSearchResult {
  const item = (raw || {}) as Record<string, unknown>;
  const slug = text(item.slug);
  return {
    id: `${site.slug}:${slug}`,
    appId: 'tutorial',
    kind: 'novel',
    title: text(item.title) || '未命名小说',
    subtitle: text(item.author) || '未知作者',
    image: text(item.cover_url),
    source: { id: site.slug, name: site.name },
    meta: { siteSlug: site.slug, author: item.author, category: item.category, tags: item.tags },
    action: { type: 'open', href: `/novels/sites/${encodeURIComponent(site.slug)}/books/${encodeURIComponent(slug)}` },
  };
}

export function normalizeDrawResult(raw: unknown): UnifiedSearchResult {
  const item = (raw || {}) as Record<string, unknown>;
  const id = text(item.id);
  return {
    id,
    appId: 'ai-draw',
    kind: 'drawing',
    title: text(item.title) || '未命名绘图',
    subtitle: text(item.engineType),
    image: text(item.thumbnail),
    meta: { engineType: item.engineType, updatedAt: item.updatedAt },
    action: { type: 'open', href: `/draw/editor/${id}` },
  };
}

export function normalizeToolResult(
  toolKey: string,
  category: string,
  strings: { title?: unknown; description?: unknown; shortDescription?: unknown }
): UnifiedSearchResult {
  return {
    id: `${category}/${toolKey}`,
    appId: 'omni-tools',
    kind: 'tool',
    title: text(strings.title) || toolKey,
    subtitle: text(strings.shortDescription),
    description: text(strings.description),
    meta: { category, toolKey },
    action: { type: 'open', href: `/tools/${category}/${toolKey}` },
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerSearchOptions {
  query: string;
  scope: SearchScope;
  limit: number;
  offset?: number;
  /** Optional disk cloud-type channel filter (pansou only), e.g. "quark" / "magnet". */
  diskType?: string;
  /**
   * Disk search source filters (pansou only), driven by the settings page.
   * `undefined` keeps the backend defaults (all enabled sources);
   * an empty array for a list explicitly disables every source in it.
   */
  diskSources?: DiskSourceFilters;
  cookie: string;
  fetchImpl?: FetchLike;
}

export interface DiskSourceFilters {
  /** Plugin ids to search; empty array disables every plugin. */
  plugins?: string[];
  /** TG channel names to search; empty array disables every channel. */
  channels?: string[];
  /** Cloud-type whitelist applied on the merged stream; empty array keeps nothing. */
  cloudTypes?: string[];
}

const MUSIC_SOURCES = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'joox', 'youtube'];

// omni-tools i18n namespace -> ToolCategory mapping (image namespace covers image-generic + png)
const NAMESPACE_CATEGORY_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  video: 'video',
  list: 'list',
  json: 'json',
  time: 'time',
  csv: 'csv',
  pdf: 'pdf',
  audio: 'audio',
  xml: 'xml',
  image: 'image-generic',
  converters: 'converters',
};

// Container: /app/apps/tools/locales/zh ; dev fallback: apps/tools/public/locales/zh
const OMNI_TOOLS_LOCALES_DIR =
  process.env.OMNI_TOOLS_LOCALES_DIR || '/app/apps/tools/locales/zh';

async function fetchJson(
  url: string,
  cookie: string,
  fetchImpl: FetchLike
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Cookie: cookie, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

// ---- 内部认证 cookie 获取与缓存 ----
// 统一身份改造：子应用鉴权模块直接校验主应用会话（mei-auth），
// 不再需要按子应用登录换取内部 cookie 的链路。

async function fetchJsonWithAuth(
  url: string,
  cookie: string,
  token: string,
  fetchImpl: FetchLike
): Promise<unknown> {
  const headers: Record<string, string> = { Cookie: cookie, Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetchImpl(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

// 统一身份改造：子应用鉴权以主应用会话令牌为准。
// DrawProvider 直接以 Bearer <主应用会话令牌> 调 ai-draw（其 authenticateToken
// 转发 /api/auth/verify 校验），不再有独立登录/JWT/凭据重置链路。
let _getPortalToken: () => string = () => '';

/** Inject the real portal-token getter (called from the API route, which runs in Next.js) */
export function _bindGetPortalToken(fn: () => string): void {
  _getPortalToken = fn;
}

function resultGroup(
  appId: string,
  label: string,
  results: UnifiedSearchResult[],
  latencyMs: number,
  hasMore: boolean,
  facets?: SearchFacet[],
): SearchGroup {
  return {
    appId,
    label,
    status: results.length ? 'ok' : 'empty',
    total: results.length,
    latencyMs,
    results,
    hasMore,
    ...(facets && facets.length > 0 ? { facets } : {}),
  };
}

async function guardProvider(
  appId: string,
  label: string,
  run: () => Promise<SearchGroup>
): Promise<SearchGroup> {
  try {
    return await run();
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || /abort/i.test(error.message));
    return {
      appId,
      label,
      status: isTimeout ? 'timeout' : 'error',
      total: 0,
      error: error instanceof Error ? error.message : String(error),
      results: [],
      hasMore: false,
    };
  }
}

// ---- SearchProvider interface and concrete adapters ----

export interface SearchProvider {
  appId: string;
  label: string;
  scope: SearchProviderApp;
  search(
    query: string,
    limit: number,
    offset: number,
    cookie: string,
    diskType?: string,
    diskSources?: DiskSourceFilters,
  ): Promise<ProviderPage>;
}

interface ProviderPage {
  results: UnifiedSearchResult[];
  hasMore: boolean;
  facets?: SearchFacet[];
}

interface FetchProviderOptions {
  fetchImpl: FetchLike;
}

class TvProvider implements SearchProvider {
  appId = 'lunatv';
  label = '影视';
  scope = 'tv' as const;
  opts: FetchProviderOptions;
  constructor(opts: FetchProviderOptions) { this.opts = opts; }
  async search(query: string, limit: number, offset: number, cookie: string): Promise<ProviderPage> {
    const base = process.env.LUNATV_INTERNAL_URL || 'http://127.0.0.1:3003';
    // 统一身份：lunatv 鉴权模块校验主应用会话（mei-auth），直接透传浏览器 cookie
    const params = new URLSearchParams({ q: query });
    const data = (await fetchJson(`${base}/tv/api/search?${params}`, cookie, this.opts.fetchImpl)) as {
      results?: unknown[];
    };
    const filtered = (data.results || []).filter((item) => {
      const title = text((item as Record<string, unknown>)?.title);
      return matchesVideoQuery(title, query);
    });
    const page = filtered.slice(offset, offset + limit).map(normalizeVideoResult);
    return { results: page, hasMore: filtered.length > offset + page.length };
  }
}

class MusicProvider implements SearchProvider {
  appId = 'solara';
  label = '音乐';
  scope = 'music' as const;
  opts: FetchProviderOptions;
  constructor(opts: FetchProviderOptions) { this.opts = opts; }
  async search(query: string, limit: number, offset: number, cookie: string): Promise<ProviderPage> {
    const base = process.env.SOLARA_INTERNAL_URL || 'http://127.0.0.1:3005';
    // 统一身份：solara 鉴权模块校验主应用会话（mei-auth），直接透传浏览器 cookie
    const pageNumber = Math.floor(offset / limit) + 1;
    const tasks = MUSIC_SOURCES.map(async (source) => {
      const pages: unknown[][] = [];
      for (let page = 1; page <= pageNumber; page += 1) {
        const params = new URLSearchParams({
          types: 'search',
          source,
          name: query,
          count: String(limit),
          pages: String(page),
        });
        const value = await fetchJson(`${base}/proxy?${params}`, cookie, this.opts.fetchImpl);
        pages.push(Array.isArray(value) ? value : []);
      }
      return pages.flat();
    });
    const settled = await Promise.allSettled(tasks);
    const failures = settled.filter((item) => item.status === 'rejected');
    if (failures.length === settled.length) throw (failures[0] as PromiseRejectedResult).reason;
    const all = settled
      .filter((item): item is PromiseFulfilledResult<unknown[]> => item.status === 'fulfilled')
      .flatMap((item) => (Array.isArray(item.value) ? item.value : []))
      .map(normalizeMusicResult);
    const page = all.slice(offset, offset + limit);
    return { results: page, hasMore: all.length > offset + page.length };
  }
}

class DisksProvider implements SearchProvider {
  appId = 'pansou';
  label = '网盘';
  scope = 'disks' as const;
  opts: FetchProviderOptions;
  constructor(opts: FetchProviderOptions) { this.opts = opts; }
  async search(query: string, limit: number, offset: number, cookie: string, diskType?: string, sources?: DiskSourceFilters): Promise<ProviderPage> {
    const base = process.env.PANSOU_INTERNAL_URL || 'http://127.0.0.1:3008';
    const params = new URLSearchParams({ kw: query, res: 'merge', src: 'all' });
    // Settings-driven source scoping. An explicitly empty list means the user
    // disabled every source in that dimension; pansou treats a missing/empty
    // param as "backend default", so send a placeholder that matches nothing.
    if (sources?.plugins !== undefined) {
      params.set('plugins', sources.plugins.length ? sources.plugins.join(',') : '__none__');
    }
    if (sources?.channels !== undefined) {
      params.set('channels', sources.channels.length ? sources.channels.join(',') : '__none__');
    }
    const payload = (await fetchJson(`${base}/api/search?${params}`, cookie, this.opts.fetchImpl)) as {
      data?: { merged_by_type?: Record<string, unknown[]> };
      merged_by_type?: Record<string, unknown[]>;
    };
    const merged = payload.data?.merged_by_type || payload.merged_by_type || {};
    // Cross-source dedupe: the same share link often comes back from several
    // plugins (with or without the extraction password). Keep one entry per
    // normalized link, preferring the variant that carries a password.
    const byKey = new Map<string, UnifiedSearchResult>();
    for (const [diskTypeKey, values] of Object.entries(merged)) {
      for (const value of Array.isArray(values) ? values : []) {
        const normalized = normalizeDiskResult(value, diskTypeKey);
        const key = diskResultDedupeKey(String(normalized.meta?.url || ''));
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, normalized);
        } else if (!existing.meta?.password && normalized.meta?.password) {
          byKey.set(key, normalized);
        }
      }
    }
    const all = [...byKey.values()];
    // Cloud-type whitelist from the settings page (applied on the merged
    // stream so facet counts stay consistent with the visible results).
    const allowedTypes = sources?.cloudTypes;
    const typed = allowedTypes === undefined
      ? all
      : all.filter((item) => {
        const key = String(item.meta?.diskType || 'unknown').toLowerCase();
        return key === 'unknown' || allowedTypes.includes(key);
      });
    const counts: Record<string, number> = {};
    for (const item of typed) {
      const key = String(item.meta?.diskType || 'unknown');
      counts[key] = (counts[key] || 0) + 1;
    }
    // Type channels paginate over their own filtered stream; facets stay global.
    const scoped = diskType ? typed.filter((item) => item.meta?.diskType === diskType) : typed;
    const page = scoped.slice(offset, offset + limit);
    return { results: page, hasMore: scoped.length > offset + page.length, facets: buildDiskFacets(counts) };
  }
}

class NovelsProvider implements SearchProvider {
  appId = 'tutorial';
  label = '小说';
  scope = 'novels' as const;
  opts: FetchProviderOptions;
  constructor(opts: FetchProviderOptions) { this.opts = opts; }
  async search(query: string, limit: number, offset: number, cookie: string): Promise<ProviderPage> {
    const base = process.env.TUTORIAL_INTERNAL_URL || 'http://127.0.0.1:3001';
    const sites = (await fetchJson(`${base}/novels/api/sites`, cookie, this.opts.fetchImpl)) as Array<{
      slug: string;
      name: string;
    }>;
    const tasks = (Array.isArray(sites) ? sites : []).map(async (site) => {
      const params = new URLSearchParams({ site: site.slug, q: query, limit: String(offset + limit) });
      const novels = (await fetchJson(`${base}/novels/api/novels?${params}`, cookie, this.opts.fetchImpl)) as unknown[];
      return (Array.isArray(novels) ? novels : []).map((novel) => normalizeNovelResult(novel, site));
    });
    const all = (await Promise.all(tasks)).flat();
    const page = all.slice(offset, offset + limit);
    return { results: page, hasMore: all.length > offset + page.length };
  }
}

class DrawProvider implements SearchProvider {
  appId = 'ai-draw';
  label = 'AI 绘图';
  scope = 'draw' as const;
  opts: FetchProviderOptions;
  constructor(opts: FetchProviderOptions) { this.opts = opts; }
  async search(query: string, limit: number, offset: number, cookie: string): Promise<ProviderPage> {
    const empty: ProviderPage = { results: [], hasMore: false };
    const base = process.env.AIDRAW_INTERNAL_URL || 'http://127.0.0.1:3004';
    // 统一身份：以主应用会话令牌作为 Bearer 凭据（ai-draw 转发 /api/auth/verify 校验）
    const token = _getPortalToken();
    if (!token) return empty;
    const params = new URLSearchParams({ search: query, pageSize: String(offset + limit) });
    let data;
    try {
      data = (await fetchJsonWithAuth(`${base}/api/projects?${params}`, cookie, token, this.opts.fetchImpl)) as {
        items?: unknown[];
      };
    } catch (err) {
      // 主应用会话失效时降级为空结果（本地 IndexedDB 文件通道仍可用，不向用户报错）
      if (/^upstream (401|403)$/.test(err instanceof Error ? err.message : '')) return empty;
      throw err;
    }
    const all = (data.items || []).map(normalizeDrawResult);
    const page = all.slice(offset, offset + limit);
    return { results: page, hasMore: all.length > offset + page.length };
  }
}

interface ToolIndexEntry {
  toolKey: string;
  category: string;
  title: string;
  subtitle: string;
  description: string;
  id: string;
}

interface ToolManifestEntry {
  /** Real router path relative to the /tools basename, e.g. "png/compress-png". */
  path: string;
  /** i18n namespace of the tool's locale strings. */
  ns: string;
  /** i18n key (camelCase) of the tool's locale strings. */
  key: string;
}

let toolsCache: ToolIndexEntry[] | null = null;
let omniToolsLocalesDirOverride: string | null = null;

/** Exposed for tests: override the locale directory at runtime */
export function _setOmniToolsLocalesDir(dir: string): void {
  omniToolsLocalesDirOverride = dir;
  toolsCache = null;
}

function getLocalesDir(): string {
  return omniToolsLocalesDirOverride || OMNI_TOOLS_LOCALES_DIR;
}

function loadToolManifest(): ToolManifestEntry[] | null {
  // locales dir is <app>/locales/<lang>; manifest lives at <app>/tool-manifest.json
  const manifestPath = path.resolve(getLocalesDir(), '..', '..', 'tool-manifest.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ToolManifestEntry[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** camelCase locale keys -> kebab-case route segments (dev fallback heuristic). */
function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

// Reads the real tool registry (tool-manifest.json, generated from defineTool calls
// at build time) and enriches it with locale strings. Falls back to scanning locale
// namespace files when the manifest is missing (dev checkouts).
function loadToolsIndex(): ToolIndexEntry[] {
  if (toolsCache) return toolsCache;
  const entries: ToolIndexEntry[] = [];
  const dir = getLocalesDir();
  const locales: Record<string, Record<string, Record<string, unknown>>> = {};
  const readNamespace = (ns: string): Record<string, Record<string, unknown>> | null => {
    if (locales[ns]) return locales[ns];
    try {
      const content = JSON.parse(fs.readFileSync(path.join(dir, `${ns}.json`), 'utf8'));
      locales[ns] = content;
      return content;
    } catch {
      locales[ns] = {};
      return null;
    }
  };
  const pushEntry = (category: string, toolKey: string, ns: string, key: string): void => {
    const strings = readNamespace(ns)?.[key];
    const s = (strings && typeof strings === 'object' ? strings : {}) as Record<string, unknown>;
    const title = text(s.title) || key;
    entries.push({
      toolKey,
      category,
      title,
      subtitle: text(s.shortDescription),
      description: text(s.description),
      id: `${category}/${toolKey}`,
    });
  };

  const manifest = loadToolManifest();
  if (manifest) {
    for (const item of manifest) {
      const [category, ...rest] = item.path.split('/');
      if (!category || rest.length === 0) continue;
      pushEntry(category, rest.join('/'), item.ns, item.key);
    }
  } else {
    for (const [namespace, category] of Object.entries(NAMESPACE_CATEGORY_MAP)) {
      const content = readNamespace(namespace);
      if (!content) continue;
      for (const [toolKey, strings] of Object.entries(content)) {
        if (!strings || typeof strings !== 'object') continue;
        const s = strings as Record<string, unknown>;
        if (!text(s.shortDescription)) continue; // skip non-tool keys (UI strings)
        pushEntry(category, toKebabCase(toolKey), namespace, toolKey);
      }
    }
  }
  toolsCache = entries;
  return entries;
}

// ToolsProvider reads omni-tools locale files at runtime to build a searchable tool list.
class ToolsProvider implements SearchProvider {
  appId = 'omni-tools';
  label = '工具箱';
  scope = 'tools' as const;
  constructor(_opts: FetchProviderOptions) {}
  async search(query: string, limit: number, offset: number, _cookie: string): Promise<ProviderPage> {
    const all = loadToolsIndex();
    const lower = query.toLowerCase();
    const matching = all
      .filter((tool) => {
        const hay = `${tool.title} ${tool.subtitle} ${tool.description} ${tool.id}`.toLowerCase();
        return hay.includes(lower);
      })
    const page = matching.slice(offset, offset + limit).map((tool) =>
        normalizeToolResult(tool.toolKey, tool.category, {
          title: tool.title,
          description: tool.description,
          shortDescription: tool.subtitle,
        })
      );
    return { results: page, hasMore: matching.length > offset + page.length };
  }
}

/** Sanitized diskType channel filter, or undefined when absent/invalid. */
export function parseDiskType(raw: string | null | undefined): string | undefined {
  const value = (raw || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,24}$/.test(value) ? value : undefined;
}

const DISK_PLUGIN_ID_RE = /^[a-z0-9_]{1,32}$/i;
const DISK_CHANNEL_RE = /^[A-Za-z0-9_]{1,64}$/;
const DISK_CLOUD_TYPE_RE = /^[a-z0-9]{1,16}$/i;

/**
 * Parse settings-driven disk source filters from the request query.
 * Returns undefined when none of plugins/channels/cloud_types is present,
 * which keeps the pansou backend defaults (all enabled sources).
 * An explicitly empty value ("plugins=") means "user disabled all".
 */
export function parseDiskSourceFilters(params: URLSearchParams): DiskSourceFilters | undefined {
  const hasAny = params.has('plugins') || params.has('channels') || params.has('cloud_types');
  if (!hasAny) return undefined;
  const parseList = (name: string, pattern: RegExp, max: number): string[] =>
    (params.get(name) || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => pattern.test(value))
      .slice(0, max);
  const filters: DiskSourceFilters = {};
  if (params.has('plugins')) filters.plugins = parseList('plugins', DISK_PLUGIN_ID_RE, 120);
  if (params.has('channels')) filters.channels = parseList('channels', DISK_CHANNEL_RE, 200);
  if (params.has('cloud_types')) filters.cloudTypes = parseList('cloud_types', DISK_CLOUD_TYPE_RE, 32);
  return filters;
}

export async function searchServerGroups(options: ServerSearchOptions): Promise<SearchGroup[]> {
  const fetchImpl = options.fetchImpl || ((input: string, init?: RequestInit) => fetch(input, init));
  const providerOpts: FetchProviderOptions = { fetchImpl };

  const providers: SearchProvider[] = [];
  if (providerEnabled(options.scope, 'tv')) providers.push(new TvProvider(providerOpts));
  if (providerEnabled(options.scope, 'music')) providers.push(new MusicProvider(providerOpts));
  if (providerEnabled(options.scope, 'disks')) providers.push(new DisksProvider(providerOpts));
  if (providerEnabled(options.scope, 'draw')) providers.push(new DrawProvider(providerOpts));
  if (providerEnabled(options.scope, 'tools')) providers.push(new ToolsProvider(providerOpts));
  if (providerEnabled(options.scope, 'novels')) providers.push(new NovelsProvider(providerOpts));

  const tasks = providers.map((provider) =>
    guardProvider(provider.appId, provider.label, async () => {
      const start = Date.now();
      const page = await provider.search(
        options.query, options.limit, options.offset || 0, options.cookie, options.diskType, options.diskSources,
      );
      return resultGroup(provider.appId, provider.label, page.results, Date.now() - start, page.hasMore, page.facets);
    })
  );

  return Promise.all(tasks);
}
