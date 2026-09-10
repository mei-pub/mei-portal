'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import MeiIcon from './MeiIcon';
import { appendDiskSourceParams } from '@/lib/app-settings-client';
import { appendSearchGroupPage } from '@/lib/search-pagination';
import {
  type SearchFacet,
  type SearchGroup,
  type SearchScope,
  type UnifiedSearchResult,
} from '@/lib/unified-search';
import { getMusicEngine, songKey, type Song } from '@/lib/music-engine';

/** Scope metadata: scope id, label, backing app id, and icon name. */
const SCOPES: Array<{ id: SearchScope; label: string; appId: string | null; icon: string }> = [
  { id: 'all', label: '综合', appId: null, icon: 'lucide:sparkles' },
  { id: 'tv', label: '影视', appId: 'lunatv', icon: 'lucide:tv' },
  { id: 'music', label: '音乐', appId: 'solara', icon: 'lucide:music' },
  { id: 'disks', label: '网盘', appId: 'pansou', icon: 'lucide:database' },
  { id: 'draw', label: 'AI绘图', appId: 'ai-draw', icon: 'lucide:palette' },
  { id: 'tools', label: '工具箱', appId: 'omni-tools', icon: 'lucide:wrench' },
  { id: 'novels', label: '小说', appId: 'tutorial', icon: 'lucide:book-open' },
];

/** Content tabs shown in the results area (one per app). */
const CONTENT_TABS = SCOPES.filter((s) => s.appId !== null) as Array<
  { id: SearchScope; label: string; appId: string; icon: string }
>;

/** Provider appId (lunatv/solara/…) -> SearchScope (tv/music/…) for page requests. */
const SCOPE_BY_APP = new Map(CONTENT_TABS.map((t) => [t.appId, t.id]));

const PAGE_SIZE = 20;

/** Build a Song from a music search result's action payload. */
function toSong(result: UnifiedSearchResult): Song {
  const payload =
    result.action.type === 'play'
      ? (result.action.payload as Record<string, unknown> | undefined)
      : undefined;
  return {
    id: String(payload?.id ?? ''),
    name: result.title,
    artist: result.subtitle ?? '',
    album: result.description,
    pic_id: payload?.pic_id != null ? String(payload.pic_id) : undefined,
    source: result.source?.id,
  };
}

/** Dispatch a play command to the global MusicDock via custom event. */
function playSong(result: UnifiedSearchResult) {
  if (result.action.type !== 'play') return;
  window.dispatchEvent(new CustomEvent('mei:music-play', { detail: { song: toSong(result) } }));
}

/** Add a song to the music engine's temp queue without playing it. */
function addToQueue(result: UnifiedSearchResult) {
  if (result.action.type !== 'play') return;
  const song = toSong(result);
  const eng = getMusicEngine();
  const key = songKey(song);
  if (!eng.temp.some((s) => songKey(s) === key)) {
    eng.replaceData({ temp: [...eng.temp, song] });
  }
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the HTTP-compatible copy path below.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}

function SourceBadge({ result }: { result: UnifiedSearchResult }) {
  if (!result.source) return null;
  return <span className="mei-source-badge">{result.source.name}</span>;
}

/** Image with graceful fallback to a placeholder icon. */
function CoverImage({
  src,
  alt,
  icon,
  className,
}: {
  src?: string;
  alt: string;
  icon: string;
  className?: string;
}) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  if (!src || err) {
    return (
      <div className={className ? `mei-cover-placeholder ${className}` : 'mei-cover-placeholder'}>
        <MeiIcon icon={icon} size={28} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} />
  );
}

// ===== Per-type full result renderers =====

/** 影视: poster grid with play overlay on hover. */
function VideoResultCard({ result }: { result: UnifiedSearchResult }) {
  const [favorite, setFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const source = result.source?.id || '';
  const id = result.id.slice(result.id.indexOf(':') + 1);
  const meta = result.meta || {};
  const year = meta.year == null ? '' : String(meta.year);
  const totalEpisodes = Array.isArray(meta.episodes) ? meta.episodes.length : Number(meta.episodes) || 1;

  useEffect(() => {
    if (!source || !id) return;
    fetch(`/tv/api/favorites?key=${encodeURIComponent(`${source}+${id}`)}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setFavorite(Boolean(value)))
      .catch(() => {});
  }, [source, id]);

  async function toggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!source || !id || favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      const key = `${source}+${id}`;
      const response = favorite
        ? await fetch(`/tv/api/favorites?key=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' })
        : await fetch('/tv/api/favorites', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key,
              favorite: {
                title: result.title,
                source_name: result.source?.name || source,
                year,
                cover: result.image || '',
                total_episodes: totalEpisodes,
                save_time: Date.now(),
              },
            }),
          });
      if (response.ok) setFavorite((current) => !current);
    } finally {
      setFavoriteBusy(false);
    }
  }

  return (
    <article className="mei-video-card">
      <Link href={result.action.type === 'open' ? result.action.href : '#'} className="mei-video-main">
        <div className="mei-video-poster">
          <CoverImage src={result.image} alt={result.title} icon="lucide:tv" />
          <div className="mei-video-play-overlay"><MeiIcon icon="lucide:play" size={22} /></div>
        </div>
        <div className="mei-video-info">
          <h3 className="mei-card-title">{result.title}</h3>
          {result.subtitle && <p className="mei-card-sub">{result.subtitle}</p>}
          <div className="mei-video-tags">
            <SourceBadge result={result} />
          </div>
        </div>
      </Link>
      <div className="mei-video-card-footer">
        <div className="mei-video-actions">
          <Link href={result.action.type === 'open' ? result.action.href : '#'} className="mei-action-btn" title="播放">
            <MeiIcon icon="lucide:play" size={14} />
          </Link>
          <button type="button" className={`mei-action-btn${favorite ? ' fav-active' : ''}`} onClick={toggleFavorite} disabled={favoriteBusy} title={favorite ? '取消收藏' : '收藏'}>
            <MeiIcon icon="lucide:heart" size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function VideoResults({ results }: { results: UnifiedSearchResult[] }) {
  return (
    <div className="mei-search-video-grid">
      {results.map((r) => <VideoResultCard key={r.id} result={r} />)}
    </div>
  );
}

/** 音乐: cover grid with play overlay, favorite, add-to-queue, and player link. */
function MusicResults({
  results,
  favSet,
  onFav,
  onAddQueue,
}: {
  results: UnifiedSearchResult[];
  favSet: Set<string>;
  onFav: (r: UnifiedSearchResult) => void;
  onAddQueue: (r: UnifiedSearchResult) => void;
}) {
  return (
    <div className="mei-search-music-grid">
      {results.map((r) => {
        const faved = favSet.has(r.id);
        return (
          <div key={r.id} className="mei-music-card">
            <div className="mei-music-cover">
              <CoverImage src={r.image} alt={r.title} icon="lucide:music" />
              <button type="button" className="mei-music-play" onClick={() => playSong(r)} title="播放">
                <MeiIcon icon="lucide:circle-play" size={24} />
              </button>
            </div>
            <h3 className="mei-card-title">{r.title}</h3>
            <p className="mei-card-sub">{[r.subtitle, r.description].filter(Boolean).join(' · ')}</p>
            <div className="mei-music-actions">
              <SourceBadge result={r} />
              <div className="mei-music-action-buttons">
                <button
                  type="button"
                  className={`mei-action-btn${faved ? ' fav-active' : ''}`}
                  onClick={() => onFav(r)}
                  title={faved ? '取消收藏' : '收藏'}
                >
                  <MeiIcon icon="lucide:heart" size={15} />
                </button>
                <button
                  type="button"
                  className="mei-action-btn"
                  onClick={() => onAddQueue(r)}
                  title="加入列表"
                >
                  <MeiIcon icon="lucide:plus" size={15} />
                </button>
                {r.action.type === 'play' && (
                  <Link href={r.action.href} className="mei-action-btn" title="打开播放页">
                    <MeiIcon icon="lucide:arrow-up-right" size={15} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 网盘: compact card grid preserves source, link type and native copy semantics. */
function DiskResultCard({ result }: { result: UnifiedSearchResult }) {
  const [copied, setCopied] = useState<'link' | 'password' | null>(null);
  const url = String(result.meta?.url || (result.action.type === 'external' ? result.action.href : ''));
  const password = result.meta?.password ? String(result.meta.password) : '';

  async function copy(value: string, kind: 'link' | 'password') {
    if (await copyText(value)) {
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1600);
    }
  }

  const isPan = result.meta?.linkType !== 'magnet' && result.meta?.linkType !== 'ed2k';
  const typeIcon = result.meta?.linkType === 'magnet' ? 'lucide:magnet' : isPan ? 'lucide:cloud' : 'lucide:link';
  return (
    <li className="mei-disk-card">
      <div className="mei-disk-card-main">
        <div className={`mei-disk-icon${isPan ? '' : ' non-pan'}`}>
          <MeiIcon icon={typeIcon} size={17} />
        </div>
        <div className="mei-disk-heading">
          <h3 className="mei-disk-title">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" title={result.title}>
                {result.title}
              </a>
            ) : (
              <span title={result.title}>{result.title}</span>
            )}
          </h3>
          <div className="mei-disk-tags">
            <SourceBadge result={result} />
            <span className="mei-disk-type">
              <MeiIcon icon={typeIcon} size={12} />
              {String(result.meta?.linkTypeLabel || '网盘链接')}
            </span>
          </div>
        </div>
      </div>
      <div className="mei-disk-card-footer">
        <div className="mei-disk-footer-info">
          {result.description && (
            <span className="mei-disk-card-meta">
              <MeiIcon icon="lucide:clock" size={11} />
              {result.description}
            </span>
          )}
        </div>
        <div className="mei-disk-actions" aria-label="资源操作">
          {password && (
            <button
              type="button"
              className={`mei-disk-password${copied === 'password' ? ' copied' : ''}`}
              onClick={() => copy(password, 'password')}
              title={copied === 'password' ? '提取码已复制' : `复制提取码 ${password}`}
            >
              <MeiIcon icon={copied === 'password' ? 'lucide:check' : 'lucide:key'} size={12} />
              <span>{password}</span>
            </button>
          )}
          <button
            type="button"
            className={`mei-disk-action${copied === 'link' ? ' copied' : ''}`}
            onClick={() => copy(url, 'link')}
            title={copied === 'link' ? '链接已复制' : '复制资源链接'}
            aria-label={copied === 'link' ? '链接已复制' : '复制资源链接'}
          >
            <MeiIcon icon={copied === 'link' ? 'lucide:check' : 'lucide:copy'} size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

function DiskResults({
  results,
  facets,
  filter,
  onFilter,
  loadingType,
}: {
  results: UnifiedSearchResult[];
  facets?: SearchFacet[];
  filter: string;
  onFilter: (key: string) => void;
  loadingType: boolean;
}) {
  const tabs = useMemo<Array<{ key: string; label: string; count: number }>>(() => {
    if (facets && facets.length > 0) {
      return [
        { key: 'all', label: '全部', count: facets.reduce((sum, facet) => sum + facet.count, 0) },
        ...facets,
      ];
    }
    // Fallback when the server payload has no facets: count the loaded page only.
    const counts = new Map<string, number>();
    for (const r of results) {
      const key = String(r.meta?.diskType || 'unknown');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [
      { key: 'all', label: '全部', count: results.length },
      ...Array.from(counts.entries())
        .map(([key, count]) => ({
          key,
          label: key === 'unknown' || key === 'others' ? '其他' : key,
          count,
        }))
        .sort((a, b) => b.count - a.count),
    ];
  }, [results, facets]);

  const visible = useMemo(
    () => (filter === 'all' ? results : results.filter((r) => String(r.meta?.diskType) === filter)),
    [results, filter],
  );
  const typeChannelPending = filter !== 'all' && loadingType && visible.length === 0;
  return (
    <div className="mei-search-disk-section">
      {tabs.length > 2 && (
        <nav className="mei-disk-tabs" aria-label="网盘类型筛选">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`mei-content-tab${filter === tab.key ? ' active' : ''}`}
              onClick={() => onFilter(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && <span className="mei-tab-count">{tab.count}</span>}
            </button>
          ))}
        </nav>
      )}
      {typeChannelPending ? (
        <div className="mei-scroll-loading">
          <span className="mei-search-spinner" />
          正在加载该类型结果…
        </div>
      ) : (
        <>
          <ul className="mei-search-disk-grid">
            {visible.map((r) => <DiskResultCard key={r.id} result={r} />)}
          </ul>
          {visible.length === 0 && <p className="mei-search-group-status empty">该类型下暂无结果</p>}
        </>
      )}
    </div>
  );
}

/** AI绘图: thumbnail grid with engine badge. */
function DrawResults({ results }: { results: UnifiedSearchResult[] }) {
  return (
    <div className="mei-search-draw-grid">
      {results.map((r) => (
        <Link
          key={r.id}
          href={r.action.type === 'open' ? r.action.href : '#'}
          className="mei-draw-card"
        >
          <div className="mei-draw-thumb">
            <CoverImage src={r.image} alt={r.title} icon="lucide:palette" />
          </div>
          <h3 className="mei-card-title">{r.title}</h3>
          {r.subtitle && <span className="mei-engine-badge">{r.subtitle}</span>}
        </Link>
      ))}
    </div>
  );
}

/** 工具箱: list layout with category badge. */
function ToolResults({ results }: { results: UnifiedSearchResult[] }) {
  return (
    <ul className="mei-search-tool-list">
      {results.map((r) => (
        <li key={r.id}>
          <Link href={r.action.type === 'open' ? r.action.href : '#'} className="mei-tool-item">
            <span className="mei-tool-icon">
              <MeiIcon icon="lucide:wrench" size={20} />
            </span>
            <div className="mei-tool-body">
              <h3 className="mei-card-title">{r.title}</h3>
              {r.subtitle && <p className="mei-card-sub">{r.subtitle}</p>}
            </div>
            {r.meta?.category != null && (
              <span className="mei-category-badge">{String(r.meta.category)}</span>
            )}
            <MeiIcon icon="lucide:arrow-up-right" size={16} className="mei-tool-arrow" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ===== Local AI-draw files (IndexedDB) =====

// The ai-draw fork locks storage to browser-local mode ("storage-mode" persist
// merge forces mode:'local'), so user files live in the browser's IndexedDB and
// never reach the ai-draw server — a server-side provider can't see them. The
// search page shares the origin with the /draw app, so it reads the same Dexie
// database ("AiDrawDatabase", store "projects") directly.

interface LocalDrawProject {
  id: string;
  title: string;
  engineType?: string;
  thumbnail?: string;
  updatedAt?: string | number;
}

function openLocalDrawDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open('AiDrawDatabase');
      // A missing DB gets created empty (no stores) — abort so we report "none".
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readLocalDrawProjects(): Promise<LocalDrawProject[]> {
  const db = await openLocalDrawDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('projects', 'readonly');
      const store = tx.objectStore('projects').getAll();
      store.onsuccess = () => {
        db.close();
        resolve(Array.isArray(store.result) ? (store.result as LocalDrawProject[]) : []);
      };
      store.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      try { db.close(); } catch { /* already closed */ }
      resolve([]);
    }
  });
}

/** Search browser-local ai-draw projects by title (same semantics as the app). */
export async function searchLocalDrawFiles(
  query: string,
  limit: number,
): Promise<UnifiedSearchResult[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const projects = await readLocalDrawProjects();
  return projects
    .filter((p) => String(p.title || '').toLowerCase().includes(normalized))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit)
    .map((p) => ({
      id: `local-draw:${p.id}`,
      appId: 'ai-draw',
      kind: 'drawing' as const,
      title: String(p.title || '未命名绘图'),
      subtitle: p.engineType ? String(p.engineType) : '本地文件',
      image: typeof p.thumbnail === 'string' && p.thumbnail ? p.thumbnail : undefined,
      meta: { engineType: p.engineType, local: true },
      action: { type: 'open' as const, href: `/draw/editor/${encodeURIComponent(p.id)}` },
    }));
}

/** 小说: cover grid with author and site badge. */
function NovelResults({ results }: { results: UnifiedSearchResult[] }) {
  return (
    <div className="mei-search-novel-grid">
      {results.map((r) => (
        <Link
          key={r.id}
          href={r.action.type === 'open' ? r.action.href : '#'}
          className="mei-novel-card"
        >
          <div className="mei-novel-cover">
            <CoverImage src={r.image} alt={r.title} icon="lucide:book-open" />
          </div>
          <h3 className="mei-card-title">{r.title}</h3>
          <p className="mei-card-sub">{r.subtitle}</p>
          <SourceBadge result={r} />
        </Link>
      ))}
    </div>
  );
}

// ===== Main component =====

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const scope = (searchParams.get('scope') || 'all') as SearchScope;
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingApps, setLoadingApps] = useState<ReadonlySet<string>>(new Set());
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  // Disk cloud-type channels: each type tab owns an independent cursor/results,
  // mirroring how the source app filters merged_by_type buckets.
  const [diskFilter, setDiskFilter] = useState('all');
  const [diskChannels, setDiskChannels] = useState<Record<string, SearchGroup>>({});
  const [loadingDiskTypes, setLoadingDiskTypes] = useState<ReadonlySet<string>>(new Set());
  const loadingDiskTypesRef = useRef<Set<string>>(new Set());
  // AI-draw files live in the browser's IndexedDB (local storage mode) — searched client-side.
  const [localDrawResults, setLocalDrawResults] = useState<UnifiedSearchResult[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Leaving AppFrame dispatches a topbar suppression during route cleanup.
  // Search is a shell-owned page, so it must explicitly restore the shared bar.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('mei-topbar-suppress', { detail: { suppressed: false } }),
    );
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mei-search-query', { detail: { query, scope } }));
  }, [query, scope]);

  // Local ai-draw files: browser-side search over the IndexedDB store shared with /draw.
  useEffect(() => {
    let cancelled = false;
    if (!query || (scope !== 'all' && scope !== 'draw')) {
      setLocalDrawResults([]);
      return;
    }
    searchLocalDrawFiles(query, PAGE_SIZE)
      .then((results) => {
        if (!cancelled) setLocalDrawResults(results);
      })
      .catch(() => {
        if (!cancelled) setLocalDrawResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query, scope]);

  // Initialize favorite set from the music engine
  useEffect(() => {
    try {
      const eng = getMusicEngine();
      setFavSet(new Set(eng.favorites.map((s) => songKey(s))));
    } catch {
 /* engine not ready yet */
    }
  }, []);

  // Fetch one fixed-size page. Later pages are appended instead of re-requesting
  // the whole result set, so providers are not capped by an arbitrary limit.
  // Bumping the version on the settings-page "config:saved" event re-runs the
  // current search so disk source changes take effect immediately.
  const [diskConfigVersion, setDiskConfigVersion] = useState(0);
  useEffect(() => {
    const onSaved = () => setDiskConfigVersion((v) => v + 1);
    window.addEventListener('config:saved', onSaved);
    return () => window.removeEventListener('config:saved', onSaved);
  }, []);
  const searchKey = `${query}\u0000${scope}\u0000${diskConfigVersion}`;
  const fetchedSearchKeyRef = useRef('');
  useEffect(() => {
    if (!query) {
      setGroups([]);
      setError('');
      setLoadingApps(new Set());
      setLoading(false);
      return;
    }
    if (fetchedSearchKeyRef.current !== searchKey) {
      fetchedSearchKeyRef.current = searchKey;
      setGroups([]);
      setLoadingApps(new Set());
      setDiskFilter('all');
      setDiskChannels({});
      loadingDiskTypesRef.current = new Set();
      setLoadingDiskTypes(new Set());
    }
    const controller = new AbortController();
    setError('');
    setLoading(true);
    const params = new URLSearchParams({ q: query, scope, limit: String(PAGE_SIZE), offset: '0' });
    appendDiskSourceParams(params);
    fetch(`/api/search?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(response.status === 401 ? '请先登录' : '搜索服务不可用');
        return response.json() as Promise<{ groups?: SearchGroup[] }>;
      })
      .then((data) => {
        setGroups(Array.isArray(data.groups) ? data.groups : []);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || '搜索失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [query, scope, searchKey]);

  const groupByApp = useMemo(() => {
    const map = new Map<string, SearchGroup>();
    for (const g of groups) map.set(g.appId, g);
    return map;
  }, [groups]);

  // Scope counts for badges (draw badge includes locally indexed files)
  const scopeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of SCOPES) {
      if (!s.appId) continue;
      const g = groupByApp.get(s.appId);
      counts[s.id] = g ? g.results.length : 0;
    }
    if (localDrawResults.length > 0) {
      counts.draw = Math.max(counts.draw, 0) + localDrawResults.length;
    }
    return counts;
  }, [groupByApp, localDrawResults]);

  // Visible scope buttons: show 综合 plus any scope with results; during initial load show all
  const visibleScopes = useMemo(() => {
    if (loading && groups.length === 0) return SCOPES;
    return SCOPES.filter((s) => s.id === 'all' || (s.appId && scopeCounts[s.id] > 0));
  }, [loading, groups, scopeCounts]);

  // Content tabs: when scope=all show all tabs with results/errors; when specific, show only that tab
  const visibleTabs = useMemo(() => {
    const hasLocalDraw = localDrawResults.length > 0;
    if (scope !== 'all') {
      return CONTENT_TABS.filter((t) => t.id === scope);
    }
    if (loading && groups.length === 0) return CONTENT_TABS;
    return CONTENT_TABS.filter((t) => {
      if (t.appId === 'ai-draw' && hasLocalDraw) return true;
      const g = groupByApp.get(t.appId);
      if (!g) return false;
      return g.status === 'ok' || g.status === 'error' || g.status === 'timeout';
    });
  }, [scope, groupByApp, loading, groups, localDrawResults]);

  // When scope changes, reset active tab
  useEffect(() => {
    if (scope !== 'all') {
      const s = SCOPES.find((item) => item.id === scope);
      setActiveTab(s?.appId ?? null);
    } else {
      setActiveTab(null);
    }
  }, [scope]);

  // Auto-select first tab with results when activeTab is null (scope=all)
  useEffect(() => {
    if (activeTab !== null) return;
    if (groups.length === 0) return;
    if (localDrawResults.length > 0) {
      const serverDraw = groupByApp.get('ai-draw');
      if (!serverDraw || serverDraw.results.length === 0) {
        setActiveTab('ai-draw');
        return;
      }
    }
    const firstWithResults = CONTENT_TABS.find((t) => {
      const g = groupByApp.get(t.appId);
      return g && g.results.length > 0;
    });
    if (firstWithResults) setActiveTab(firstWithResults.appId);
  }, [activeTab, groups, groupByApp, localDrawResults]);

  const activeGroup = activeTab ? groupByApp.get(activeTab) : null;

  // Active disk type channel (only while the pansou tab is shown and a type is picked)
  const diskChannelActive = activeTab === 'pansou' && diskFilter !== 'all';
  const diskChannel = diskChannelActive ? diskChannels[diskFilter] : undefined;
  const diskTypeLoading = diskChannelActive ? loadingDiskTypes.has(diskFilter) : false;

  async function fetchDiskChannel(type: string, offset: number) {
    if (loadingDiskTypesRef.current.has(type)) return;
    loadingDiskTypesRef.current.add(type);
    setLoadingDiskTypes(new Set(loadingDiskTypesRef.current));
    try {
      const params = new URLSearchParams({
        q: query,
        scope: 'disks',
        limit: String(PAGE_SIZE),
        offset: String(offset),
        diskType: type,
      });
      appendDiskSourceParams(params);
      const response = await fetch(`/api/search?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error(response.status === 401 ? '请先登录' : '搜索服务不可用');
      const data = await response.json() as { groups?: SearchGroup[] };
      const next = data.groups?.find((item) => item.appId === 'pansou');
      if (!next) throw new Error('搜索服务返回为空');
      if (fetchedSearchKeyRef.current !== searchKey) return;
      setDiskChannels((previous) => {
        const existing = previous[type];
        const merged = existing && offset > 0 ? appendSearchGroupPage(existing, next) : next;
        return { ...previous, [type]: merged };
      });
    } catch (err) {
      if (fetchedSearchKeyRef.current !== searchKey) return;
      setError(`网盘类型「${type}」加载失败：${err instanceof Error ? err.message : '未知错误'}`);
      setDiskChannels((previous) => (previous[type]
        ? { ...previous, [type]: { ...previous[type], hasMore: false } }
        : previous));
    } finally {
      loadingDiskTypesRef.current.delete(type);
      if (fetchedSearchKeyRef.current === searchKey) {
        setLoadingDiskTypes(new Set(loadingDiskTypesRef.current));
      }
    }
  }

  function handleDiskFilter(type: string) {
    setDiskFilter(type);
    if (type !== 'all' && !diskChannels[type]) {
      fetchDiskChannel(type, 0);
    }
  }

  // Every content tab owns its cursor and in-flight state.
  const showLoadMore = useMemo(() => {
    if (loading || (activeTab && loadingApps.has(activeTab)) || diskTypeLoading) return false;
    if (diskChannelActive) return Boolean(diskChannel?.hasMore);
    return Boolean(activeGroup?.hasMore);
  }, [activeGroup, activeTab, loading, loadingApps, diskChannelActive, diskChannel, diskTypeLoading]);

  // Infinite scroll: observe sentinel, auto-trigger loadMore when it enters viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !showLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (diskChannelActive) {
          if (diskChannel && showLoadMore) fetchDiskChannel(diskFilter, diskChannel.results.length);
        } else if (activeGroup && showLoadMore) {
          loadMore(activeGroup);
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeGroup, showLoadMore, diskChannelActive, diskChannel, diskFilter]);

  function switchScope(next: SearchScope) {
    const params = new URLSearchParams({ q: query, scope: next });
    router.push(`/search?${params.toString()}`);
  }

  async function loadMore(group: SearchGroup) {
    if (loadingApps.has(group.appId) || !group.hasMore) return;
    const requestKey = searchKey;
    const offset = group.results.length;
    setLoadingApps((prev) => new Set(prev).add(group.appId));
    try {
      const params = new URLSearchParams({
        q: query,
        // appId（如 lunatv）不是 SearchScope（tv），直接传会被服务端回落成 all、
        // 导致分页请求扇出全部 provider；先映射成该 provider 的 scope。
        scope: SCOPE_BY_APP.get(group.appId) || 'all',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (group.appId === 'pansou') appendDiskSourceParams(params);
      const response = await fetch(`/api/search?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(response.status === 401 ? '请先登录' : '搜索服务不可用');
      const data = await response.json() as { groups?: SearchGroup[] };
      const next = data.groups?.find((item) => item.appId === group.appId);
      if (!next) throw new Error('搜索服务返回为空');
      if (fetchedSearchKeyRef.current !== requestKey) return;

      setGroups((previous) => previous.map(
        (current) => (current.appId === group.appId ? appendSearchGroupPage(current, next) : current),
      ));
    } catch (err) {
      if (fetchedSearchKeyRef.current !== requestKey) return;
      setGroups((previous) => previous.map(
        (current) => (current.appId === group.appId
          ? { ...current, hasMore: false }
          : current),
      ));
      setError(`${group.label}加载更多失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      if (fetchedSearchKeyRef.current === requestKey) {
        setLoadingApps((prev) => {
          const next = new Set(prev);
          next.delete(group.appId);
          return next;
        });
      }
    }
  }

  function toggleFav(result: UnifiedSearchResult) {
    const song = toSong(result);
    const eng = getMusicEngine();
    const wasFav = eng.isFavorite(song);
    eng.toggleFavorite(song);
    setFavSet((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(result.id);
      else next.add(result.id);
      return next;
    });
  }

  function handleAddQueue(result: UnifiedSearchResult) {
    addToQueue(result);
  }

  // Render the active group's results with type-appropriate rendering
  function renderActiveGroup(group: SearchGroup) {
    if (group.status === 'error') {
      return <p className="mei-search-group-status error">{group.error || '搜索失败'}</p>;
    }
    if (group.status === 'timeout') {
      return <p className="mei-search-group-status timeout">搜索超时，请稍后重试</p>;
    }
    // ai-draw can still show locally indexed (IndexedDB) files when the server returns none.
    const hasLocalDraw = group.appId === 'ai-draw' && localDrawResults.length > 0;
    if (group.results.length === 0 && !hasLocalDraw) {
      return <p className="mei-search-group-status empty">没有找到相关结果</p>;
    }
    switch (group.appId) {
      case 'lunatv':
        return <VideoResults results={group.results} />;
      case 'solara':
        return (
          <MusicResults
            results={group.results}
            favSet={favSet}
            onFav={toggleFav}
            onAddQueue={handleAddQueue}
          />
        );
      case 'pansou':
        return (
          <DiskResults
            key={`disk-${query}`}
            results={diskChannelActive ? (diskChannel?.results || []) : group.results}
            facets={group.facets}
            filter={diskFilter}
            onFilter={handleDiskFilter}
            loadingType={diskTypeLoading}
          />
        );
      case 'ai-draw': {
        // Local (IndexedDB) files first, then any server-side results; dedupe by id.
        const seen = new Set<string>();
        const merged = [...localDrawResults, ...group.results].filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        return <DrawResults results={merged} />;
      }
      case 'omni-tools':
        return <ToolResults results={group.results} />;
      case 'tutorial':
        return <NovelResults results={group.results} />;
      default:
        return null;
    }
  }

  // True when every non-"all" scope has zero results (local draw files count as results)
  const allEmpty =
    groups.length > 0 &&
    localDrawResults.length === 0 &&
    SCOPES.filter((s) => s.appId).every((s) => {
      const g = groupByApp.get(s.appId!);
      return !g || g.results.length === 0;
    });

  return (
    <div className="mei-search-page">
      <div className="mei-aurora" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>
      <main className="mei-search-main">
        <header className="mei-search-header">
          <div>
            <p className="mei-search-kicker">Cross-app search</p>
            <h1>{scope === 'all' ? '全站聚合搜索' : `${SCOPES.find((item) => item.id === scope)?.label || '应用'}搜索结果`}</h1>
            {query && <p className="mei-search-query">正在检索「{query}」</p>}
          </div>
          {/* Scope buttons (near search input): control what gets searched */}
          <nav className="mei-search-scopes" aria-label="搜索范围">
            {visibleScopes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={scope === item.id ? 'active' : ''}
                onClick={() => switchScope(item.id)}
              >
                <MeiIcon icon={item.icon} size={15} />
                {item.label}
                {item.id !== 'all' && scopeCounts[item.id] > 0 && (
                  <span className="mei-tab-count">{scopeCounts[item.id]}</span>
                )}
              </button>
            ))}
          </nav>
        </header>

        {!query && (
          <div className="mei-search-empty-state">
            <MeiIcon icon="lucide:sparkles" size={26} />
            <h2>一个入口，搜索所有应用</h2>
            <p>输入关键词后，影视、音乐、网盘、AI 绘图、工具箱和小说结果会并行返回。</p>
          </div>
        )}

        {query && error && <div className="mei-search-alert">{error}</div>}

        {query && loading && groups.length === 0 && (
          <div className="mei-search-loading">
            <span className="mei-search-spinner" />
            正在并行搜索各应用…
          </div>
        )}

        {/* Results with content tabs */}
        {query && groups.length > 0 && (
          <div className="mei-search-results">
            {visibleTabs.length > 0 && (
             <nav className="mei-content-tabs" aria-label="结果分类">
                {visibleTabs.map((tab) => {
                  const g = groupByApp.get(tab.appId);
                  const count = g ? g.results.length : 0;
                  return (
                    <button
                      key={tab.appId}
                      type="button"
                      className={`mei-content-tab${activeTab === tab.appId ? ' active' : ''}`}
                      onClick={() => setActiveTab(tab.appId)}
                    >
                      <MeiIcon icon={tab.icon} size={15} />
                      {tab.label}
                      {count > 0 && <span className="mei-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </nav>
            )}

            <div className="mei-search-tab-content">
              {activeGroup ? (
                renderActiveGroup(activeGroup)
              ) : (
                allEmpty && (
                  <p className="mei-search-group-status empty">没有找到相关结果</p>
                )
              )}
            </div>

            {showLoadMore && (
              <div className="mei-scroll-sentinel" ref={sentinelRef} />
            )}
            {(activeTab && loadingApps.has(activeTab)) || diskTypeLoading ? (
              <div className="mei-scroll-loading">
                <span className="mei-search-spinner" />
                正在加载更多…
              </div>
            ) : null}
            {!showLoadMore && activeGroup && !loadingApps.has(activeGroup.appId) && !diskTypeLoading
              && (diskChannelActive
                ? Boolean(diskChannel) && !diskChannel?.hasMore && (diskChannel?.results.length || 0) > 0
                : activeGroup.results.length > 0 && !activeGroup.hasMore) && (
              <div className="mei-scroll-end">
                <MeiIcon icon="lucide:check" size={14} />
                已加载全部结果
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
