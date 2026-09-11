'use client';
// 门户级音乐播放引擎（常驻外壳，跨子应用切换不中断）
//
// 设计要点：
// - 单例 Audio 挂在外壳页面上，子应用在 iframe 内切换不会销毁它；
// - 队列 / 收藏 / 播放列表数据由本引擎持有，通过 /api/music/state 跟账户持久化；
// - 播放地址解析走音乐应用自身的 /proxy（复用其服务端源实现），基址由插件清单决定；
// - 音乐子应用（solara）在 iframe 内通过 postMessage 把播放指令委托给本引擎。

export type QueueType = 'temp' | 'playlist' | 'fav';
export type PlayMode = 'order' | 'shuffle' | 'repeat';
/**
 * 播放条三形态：
 * - full：完整形态，封面 + 信息 + 全部控件 + 进度 + 音量 + 队列
 * - mini：缩小形态，胶囊小球，只留封面 + 播放/暂停 + 环形进度
 * - hidden：隐藏形态，仅保留贴底渐变把手
 */
export type DockMode = 'full' | 'mini' | 'hidden';
export const DOCK_MODES: DockMode[] = ['full', 'mini', 'hidden'];

export interface Song {
  id: string;
  name: string;
  artist: string;
  album?: string;
  pic_id?: string;
  lyric_id?: string;
  source?: string;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
}

export interface EngineSnapshot {
  ready: boolean;
  playlists: Playlist[];
  favorites: Song[];
  temp: Song[];
  selectedPlaylistId: string;
  queueType: QueueType;
  playlistId: string;
  index: number;
  mode: PlayMode;
  song: Song | null;
  queueLabel: string;
  queueLength: number;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  dockMode: DockMode;
  dockLastVisible: Exclude<DockMode, 'hidden'>;
  error: string;
}

const STATE_API = '/api/music/state';
const LEGACY_PLAYLISTS = 'meiMusicPlaylists.v1';
const LEGACY_FAVORITES = 'favoriteSongs';
const LEGACY_SELECTED = 'meiMusicSelectedList.v1';
const DOCK_KEY = 'mei-music-dock-mode';
const DOCK_LAST_KEY = 'mei-music-dock-last-visible';
const LEGACY_DOCK_KEY = 'mei-music-dock-collapsed';
const LOCAL_SNAPSHOT = 'mei-music-local-state.v1';

const ALL_SOURCES = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'joox', 'bilibili', 'youtube'];
const DEFAULT_SOURCES = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'joox', 'youtube'];

function songKey(song: Song): string {
  return `${song.source || 'netease'}:${song.id}`;
}

function sig(): string {
  return Math.random().toString(36).slice(2, 12);
}

function readJson<T>(key: string, dft: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return dft;
    const parsed = JSON.parse(raw);
    return (parsed ?? dft) as T;
  } catch {
    return dft;
  }
}

class MusicEngine {
  audio: HTMLAudioElement | null = null;
  playlists: Playlist[] = [];
  favorites: Song[] = [];
  temp: Song[] = [];
  selectedPlaylistId = '';
  queueType: QueueType = 'temp';
  playlistId = '';
  index = -1;
  mode: PlayMode = 'order';
  volume = 1;
  dockMode: DockMode = 'full';
  dockLastVisible: Exclude<DockMode, 'hidden'> = 'full';
  ready = false;
  loading = false;
  error = '';

  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot | null = null;
  private revision = 0;
  private loggedIn = false;
  private musicBase = '/music';
  private playToken = 0;
  private failStreak = 0;
  private failureHandledToken = 0;
  private mediaObjectUrl = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savingChain: Promise<void> = Promise.resolve();
  private pendingPosition = 0;
  private booted = false;

  // ---- 订阅（React useSyncExternalStore）----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EngineSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  private buildSnapshot(): EngineSnapshot {
    const queue = this.queue();
    return {
      ready: this.ready,
      playlists: this.playlists,
      favorites: this.favorites,
      temp: this.temp,
      selectedPlaylistId: this.selectedPlaylistId,
      queueType: this.queueType,
      playlistId: this.playlistId,
      index: this.index,
      mode: this.mode,
      song: queue[this.index] || null,
      queueLabel: this.queueLabel(),
      queueLength: queue.length,
      playing: !!this.audio && !this.audio.paused && !!this.audio.src,
      loading: this.loading,
      currentTime: this.audio ? this.audio.currentTime || 0 : 0,
      duration: this.audio && Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      volume: this.volume,
      dockMode: this.dockMode,
      dockLastVisible: this.dockLastVisible,
      error: this.error,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    this.pushMediaSession();
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  // ---- 启动 ----
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('timeupdate', () => {
      this.pendingPosition = this.audio?.currentTime || 0;
      this.emit();
      this.schedulePositionSave();
    });
    this.audio.addEventListener('durationchange', () => this.emit());
    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('error', () => {
      if (!this.audio?.src) return;
      const song = this.current();
      if (song) this.handlePlaybackFailure(song, this.playToken);
      this.emit();
    });
    this.readDockPrefs();
    await this.resolveMusicBase();
    await this.loadState();
    this.ready = true;
    this.emit();
  }

  /** 形态偏好优先读本地（切页即时生效），并兼容旧版布尔 key */
  private readDockPrefs(): void {
    try {
      const stored = localStorage.getItem(DOCK_KEY);
      if (stored && (DOCK_MODES as string[]).includes(stored)) {
        this.dockMode = stored as DockMode;
      } else if (localStorage.getItem(LEGACY_DOCK_KEY) === '1') {
        this.dockMode = 'hidden';
      }
      const last = localStorage.getItem(DOCK_LAST_KEY);
      this.dockLastVisible = last === 'mini' ? 'mini' : 'full';
      if (this.dockMode !== 'hidden') this.dockLastVisible = this.dockMode;
    } catch {}
  }

  private async resolveMusicBase(): Promise<void> {
    try {
      const res = await fetch('/api/plugins', { credentials: 'include' });
      const plugins = (await res.json()) as Array<{ id: string; url: string }>;
      const solara = Array.isArray(plugins) ? plugins.find((p) => p.id === 'solara') : null;
      if (solara?.url) this.musicBase = solara.url.replace(/\/+$/, '') || '/music';
    } catch {
      // 保留默认 /music
    }
  }

  private async loadState(): Promise<void> {
    let serverState: Record<string, unknown> | null = null;
    try {
      const res = await fetch(STATE_API, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        this.loggedIn = data?.loggedIn === true;
        serverState = data?.state || null;
      }
    } catch {
      // 服务端不可用：退化为本地状态
    }
    const local = readJson<Record<string, unknown> | null>(LOCAL_SNAPSHOT, null);
    const legacyPlaylists = readJson<Playlist[]>(LEGACY_PLAYLISTS, []);
    const legacyFavorites = readJson<Song[]>(LEGACY_FAVORITES, []);
    let legacySelected = '';
    try {
      legacySelected = localStorage.getItem(LEGACY_SELECTED) || '';
    } catch {}

    const pick = (server: unknown, localValue: unknown, legacy: unknown) => {
      if (Array.isArray(server) && server.length > 0) return server;
      if (Array.isArray(localValue) && localValue.length > 0) return localValue;
      if (Array.isArray(legacy) && legacy.length > 0) return legacy;
      return [];
    };

    const source = serverState && (serverState.revision as number) > 0 ? serverState : local || serverState || {};
    this.revision = Number(serverState?.revision) || 0;
    this.playlists = pick(serverState?.playlists, local?.playlists, legacyPlaylists) as Playlist[];
    this.favorites = pick(serverState?.favorites, local?.favorites, legacyFavorites) as Song[];
    this.temp = pick(serverState?.temp, local?.temp, []) as Song[];
    this.selectedPlaylistId =
      (source.selectedPlaylistId as string) ||
      (local?.selectedPlaylistId as string) ||
      legacySelected ||
      '';
    const queue = (source.queue || {}) as Record<string, unknown>;
    const playback = (source.playback || {}) as Record<string, unknown>;
    this.queueType = (['temp', 'playlist', 'fav'].includes(String(queue.type)) ? queue.type : 'temp') as QueueType;
    this.playlistId = String(queue.playlistId || '');
    this.mode = (['order', 'shuffle', 'repeat'].includes(String(playback.mode)) ? playback.mode : 'order') as PlayMode;
    this.volume = Number.isFinite(Number(playback.volume)) ? Math.min(1, Math.max(0, Number(playback.volume))) : 1;
    if (this.audio) this.audio.volume = this.volume;
    // 服务端形态仅在本地无偏好时采纳，避免跨设备偏好互相覆盖
    const ui = (source.ui || {}) as Record<string, unknown>;
    let hasLocalDockPref = false;
    try {
      hasLocalDockPref = !!localStorage.getItem(DOCK_KEY) || !!localStorage.getItem(LEGACY_DOCK_KEY);
    } catch {}
    if (!hasLocalDockPref) {
      if ((DOCK_MODES as string[]).includes(String(ui.dockMode))) {
        this.dockMode = ui.dockMode as DockMode;
      } else if (ui.dockCollapsed === true) {
        this.dockMode = 'hidden';
      }
      this.dockLastVisible = ui.dockLastVisible === 'mini' ? 'mini' : 'full';
      if (this.dockMode !== 'hidden') this.dockLastVisible = this.dockMode;
    }
    if (this.playlists.length === 0) {
      this.playlists = [{ id: `pl${Date.now()}`, name: '默认列表', songs: [] }];
    }
    if (!this.playlists.some((p) => p.id === this.selectedPlaylistId)) {
      this.selectedPlaylistId = this.playlists[0].id;
    }
    const q = this.queue();
    const idx = Math.floor(Number(queue.index));
    this.index = Number.isFinite(idx) && idx >= 0 && idx < q.length ? idx : q.length > 0 ? 0 : -1;
    // 恢复上次播放进度：只装载不自动播放（浏览器自动播放策略）
    this.pendingPosition = Number(playback.position) || 0;
    if (this.index >= 0) {
      void this.playIndex(this.index, false, this.pendingPosition);
    }
  }

  // ---- 持久化 ----
  private serialize(): Record<string, unknown> {
    return {
      revision: this.revision,
      playlists: this.playlists,
      favorites: this.favorites,
      temp: this.temp,
      selectedPlaylistId: this.selectedPlaylistId,
      queue: { type: this.queueType, playlistId: this.playlistId, index: this.index },
      playback: { mode: this.mode, position: this.pendingPosition, volume: this.volume },
      ui: { dockMode: this.dockMode, dockLastVisible: this.dockLastVisible },
    };
  }

  private persistLocal(): void {
    try {
      localStorage.setItem(LOCAL_SNAPSHOT, JSON.stringify(this.serialize()));
      // 兼容音乐应用独立访问（未经外壳）时的本地读取
      localStorage.setItem(LEGACY_PLAYLISTS, JSON.stringify(this.playlists));
      localStorage.setItem(LEGACY_FAVORITES, JSON.stringify(this.favorites));
      localStorage.setItem(LEGACY_SELECTED, this.selectedPlaylistId);
    } catch {}
  }

  /** 数据变更：本地即时落盘 + 服务端防抖串行写入（保序，避免旧数据覆盖新数据） */
  save(delay = 700): void {
    this.persistLocal();
    if (!this.loggedIn) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const payload = this.serialize();
      this.savingChain = this.savingChain.then(async () => {
        try {
          const res = await fetch(STATE_API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          });
          if (res.status === 409) {
            const data = await res.json();
            this.revision = Number(data?.state?.revision) || this.revision;
            return;
          }
          if (res.ok) {
            const data = await res.json();
            this.revision = Number(data?.state?.revision) || this.revision + 1;
          }
        } catch {
          // 网络异常：下次变更再试，本地快照已保住数据
        }
      });
    }, delay);
  }

  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private schedulePositionSave(): void {
    if (this.positionTimer) return;
    this.positionTimer = setTimeout(() => {
      this.positionTimer = null;
      this.save(0);
    }, 5000);
  }

  // ---- 队列 ----
  queue(): Song[] {
    if (this.queueType === 'fav') return this.favorites;
    if (this.queueType === 'playlist') {
      const pl = this.getPlaylist(this.playlistId);
      return pl ? pl.songs : [];
    }
    return this.temp;
  }

  queueLabel(): string {
    if (this.queueType === 'fav') return '我的收藏';
    if (this.queueType === 'playlist') {
      const pl = this.getPlaylist(this.playlistId);
      return pl ? pl.name : '播放列表';
    }
    return '临时列表';
  }

  current(): Song | null {
    return this.queue()[this.index] || null;
  }

  getPlaylist(id: string): Playlist | null {
    return this.playlists.find((p) => p.id === id) || null;
  }

  setQueue(type: QueueType, startIndex = 0, playlistId = ''): void {
    this.queueType = type;
    if (playlistId) this.playlistId = playlistId;
    if (type === 'playlist' && !this.getPlaylist(this.playlistId)) {
      this.playlistId = this.playlists[0]?.id || '';
    }
    const q = this.queue();
    this.index = q.length > 0 ? Math.min(Math.max(startIndex, 0), q.length - 1) : -1;
    this.save();
    this.emit();
  }

  /** 立即播放单曲（下载中心等外部应用的 play-now 协议）：进临时队列，
   *  不打扰已有播放列表/收藏；外壳引擎播放、MusicDock 常驻，跨应用不断播 */
  playNow(song: Song): void {
    this.temp = [song];
    this.setQueue('temp', 0);
    void this.playIndex(0);
  }

  /** 整体替换数据（音乐应用内的增删改都走这里，外壳是唯一持久化出口） */
  replaceData(data: {
    playlists?: Playlist[];
    favorites?: Song[];
    temp?: Song[];
    selectedPlaylistId?: string;
  }): void {
    if (Array.isArray(data.playlists)) this.playlists = data.playlists;
    if (Array.isArray(data.favorites)) this.favorites = data.favorites;
    if (Array.isArray(data.temp)) this.temp = data.temp;
    if (typeof data.selectedPlaylistId === 'string') this.selectedPlaylistId = data.selectedPlaylistId;
    const q = this.queue();
    if (this.index >= q.length) this.index = q.length - 1;
    this.save();
    this.emit();
  }

  isFavorite(song: Song): boolean {
    return this.favorites.some((s) => songKey(s) === songKey(song));
  }

  /** 从当前队列移除一首（正在播的那首被移除时顺延到下一首） */
  removeFromQueue(i: number): void {
    const q = this.queue();
    if (i < 0 || i >= q.length) return;
    const removingCurrent = i === this.index;
    q.splice(i, 1);
    if (this.queueType === 'fav') this.favorites = [...q];
    else if (this.queueType === 'temp') this.temp = [...q];
    else {
      const pl = this.getPlaylist(this.playlistId);
      if (pl) pl.songs = [...q];
      this.playlists = [...this.playlists];
    }
    if (q.length === 0) {
      this.index = -1;
      this.stop();
    } else if (removingCurrent) {
      void this.playIndex(Math.min(i, q.length - 1));
    } else if (i < this.index) {
      this.index -= 1;
    }
    this.save();
    this.emit();
  }

  /** 停止播放并清空音频源（队列被清空时使用） */
  stop(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (this.mediaObjectUrl) {
      URL.revokeObjectURL(this.mediaObjectUrl);
      this.mediaObjectUrl = '';
    }
    this.emit();
  }

  toggleFavorite(song: Song): boolean {
    const key = songKey(song);
    const idx = this.favorites.findIndex((s) => songKey(s) === key);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      this.favorites = [...this.favorites];
      this.save();
      this.emit();
      return false;
    }
    this.favorites = [{ ...song }, ...this.favorites];
    this.save();
    this.emit();
    return true;
  }

  /** 设置播放条形态（full / mini / hidden），记忆到本地 + 账户 */
  setDockMode(mode: DockMode): void {
    if (!DOCK_MODES.includes(mode) || mode === this.dockMode) return;
    this.dockMode = mode;
    if (mode !== 'hidden') this.dockLastVisible = mode;
    try {
      localStorage.setItem(DOCK_KEY, this.dockMode);
      localStorage.setItem(DOCK_LAST_KEY, this.dockLastVisible);
      localStorage.removeItem(LEGACY_DOCK_KEY);
    } catch {}
    this.save();
    this.emit();
  }

  /** 从隐藏态展开：回到上一次的可见形态 */
  restoreDock(): void {
    this.setDockMode(this.dockLastVisible);
  }

  /** 形态循环：完整 → 缩小 → 隐藏 → 完整（供快捷键/顶栏入口使用） */
  cycleDockMode(): DockMode {
    const next = DOCK_MODES[(DOCK_MODES.indexOf(this.dockMode) + 1) % DOCK_MODES.length];
    this.setDockMode(next);
    return next;
  }

  // ---- 播放地址解析（复用音乐应用服务端源）----
  private proxyUrl(params: Record<string, string>, options: { nocache?: boolean } = {}): string {
    const search = new URLSearchParams({ ...params, s: sig() });
    if (options.nocache) search.set('nocache', 'true');
    return `${this.musicBase}/proxy?${search.toString()}`;
  }

  private enabledSources(): string[] {
    const list = readJson<string[]>('mei-music-sources', []);
    const valid = Array.isArray(list) ? list.filter((v) => ALL_SOURCES.includes(v)) : [];
    return valid.length > 0 ? valid : DEFAULT_SOURCES;
  }

  private wrapStream(url: string, headers?: Record<string, string> | null): string {
    if (!url) return url;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const needsProxy =
      parsed.protocol === 'http:' ||
      /(^|\.)qq\.com$/i.test(parsed.hostname) ||
      /(^|\.)googlevideo\.com$/i.test(parsed.hostname);
    if (!needsProxy) return url;
    const params = new URLSearchParams({ target: url });
    if (headers && Object.keys(headers).length > 0) params.set('headers', JSON.stringify(headers));
    return `${this.musicBase}/proxy?${params.toString()}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`请求失败（${res.status}）`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---- 本地服务器已下载曲库（「本地优先」：同曲已有本地文件就不再走网络源）----
  private localLibraryAt = 0;
  private localLibraryFiles: Array<{ name: string; artist: string; path: string }> = [];

  /** 刷新已下载曲库索引（60s 缓存；失败静默——库不可用绝不阻塞播放） */
  private async refreshLocalLibrary(): Promise<void> {
    const now = Date.now();
    if (this.localLibraryFiles.length > 0 && now - this.localLibraryAt < 60_000) return;
    try {
      const data = (await this.fetchJson(`${this.musicBase}/api/download/library`)) as {
        files?: Array<Record<string, unknown>>;
      };
      if (data && typeof data === 'object' && Array.isArray(data.files)) {
        this.localLibraryFiles = data.files
          .map((f) => ({ name: String(f.name || ''), artist: String(f.artist || ''), path: String(f.path || '') }))
          .filter((f) => f.path !== '');
        this.localLibraryAt = now;
      }
    } catch {
      this.localLibraryAt = now; // 失败也记时间：不可用期间每分钟至多重试一次
    }
  }

  /** 命中本地已下载文件（同名+同歌手，忽略大小写与空白差异）则返回 serve 流地址 */
  private async tryLocalFile(song: Song): Promise<string | null> {
    await this.refreshLocalLibrary();
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const name = norm(song.name || '');
    if (!name) return null;
    const artist = norm(song.artist || '');
    const hit = this.localLibraryFiles.find(
      (f) => norm(f.name) === name && (!artist || norm(f.artist) === artist)
    );
    if (!hit) return null;
    return `${this.musicBase}/api/download/serve?path=${encodeURIComponent(hit.path)}`;
  }

  /**
   * 解析单源播放地址。音质降级链 [320→192→128] 只对上游 gdstudio 有意义；
   * 本地源（qq/kugou/kuwo 服务端直连实现）返回 400 表示该曲无任何可用地址
   * （与码率无关），此时立刻中断降级链交给跨源兜底，否则同一首歌会把
   * 服务端降级链白跑三遍。
   */
  private async resolvePlayUrl(song: Song, quality = '320', options: { nocache?: boolean } = {}): Promise<string> {
    if (song.source === 'youtube') {
      return this.proxyUrl(
        {
          types: 'download',
          source: 'youtube',
          id: song.id,
          br: quality,
          filename: `${song.name || 'music'} - ${song.artist || 'youtube'}`,
        },
        options
      );
    }
    const chain = [quality, '192', '128'].filter((v, i, a) => a.indexOf(v) === i);
    for (const br of chain) {
      try {
        const data = (await this.fetchJson(
          this.proxyUrl({ types: 'url', id: String(song.id), source: song.source || 'netease', br }, options)
        )) as { url?: string; headers?: Record<string, string> };
        if (data && typeof data === 'object' && data.url) return this.wrapStream(data.url, data.headers);
      } catch (e) {
        if ((e as { status?: number })?.status === 400) break;
        // 尝试下一档码率
      }
    }
    throw new Error('未获取到播放地址');
  }

  /** 跨源兜底：本源解析失败时按「歌名 + 歌手」在其他启用源找同名歌 */
  private async resolveWithFallback(
    song: Song,
    quality = '320',
    options: { nocache?: boolean } = {}
  ): Promise<{ url: string; song: Song }> {
    try {
      // 本地服务器优先：播放列表/收藏/搜索播放的全部路径，已下载的同名曲直接用本地文件
      const localUrl = await this.tryLocalFile(song);
      if (localUrl) return { url: localUrl, song };
      return { url: await this.resolvePlayUrl(song, quality, options), song };
    } catch (firstError) {
      const key = songKey(song);
      const keyword = `${song.name} ${song.artist}`;
      const candidates: Song[] = [];
      await Promise.all(
        this.enabledSources().map(async (src) => {
          try {
            const data = (await this.fetchJson(
              this.proxyUrl({ types: 'search', source: src, name: keyword, count: '3', pages: '1' })
            )) as Array<Record<string, unknown>>;
            if (Array.isArray(data)) {
              for (const raw of data) {
                candidates.push({
                  id: String(raw.id),
                  name: String(raw.name || ''),
                  artist: Array.isArray(raw.artist) ? raw.artist.join(' / ') : String(raw.artist || ''),
                  album: String(raw.album || ''),
                  pic_id: String(raw.pic_id || raw.pic || ''),
                  lyric_id: String(raw.lyric_id || raw.id || ''),
                  source: String(raw.source || src),
                });
              }
            }
          } catch {
            // 源级失败忽略
          }
        })
      );
      for (const candidate of candidates.filter((s) => songKey(s) !== key).slice(0, 6)) {
        try {
          return { url: await this.resolvePlayUrl(candidate, quality, options), song: candidate };
        } catch {
          // 下一个候选
        }
      }
      throw firstError;
    }
  }

  picUrl(song: Song | null, size = 300): string {
    if (!song || !song.pic_id) return '';
    return this.proxyUrl({ types: 'pic', id: song.pic_id, source: song.source || 'netease', size: String(size) });
  }

  /** 音乐应用播放页入口（走承载页，外壳不卸载） */
  playerPageHref(): string {
    return `${this.musicBase}/player`;
  }

  // ---- 播放控制 ----
  async playIndex(
    i: number,
    autoplay = true,
    startAt = 0,
    options: { nocache?: boolean; retry?: boolean } = {}
  ): Promise<void> {
    const q = this.queue();
    if (i < 0 || i >= q.length) return;
    const playToken = ++this.playToken;
    this.failureHandledToken = 0;
    // 用户主动（重新）点播时重置重试标记：同一首歌允许在新一轮播放里再重解析一次
    if (options.retry !== true) this.retriedSongKey = '';
    this.index = i;
    this.error = '';
    this.loading = true;
    const song = q[i];
    // 立即同步快照：即便后续 URL 解析失败或音频未就绪，snap.song 也已就绪供 Dock 渲染
    this.emit();
    this.save();
    const audio = this.audio;
    if (!audio) return;
    // 切歌瞬间必须先停旧音频：地址解析是异步的，否则旧歌会继续放
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (this.mediaObjectUrl) {
      URL.revokeObjectURL(this.mediaObjectUrl);
      this.mediaObjectUrl = '';
    }
    this.emit();
    this.save();
    try {
      const { url, song: played } = await this.resolveWithFallback(song, '320', {
        nocache: options.nocache === true,
      });
      if (playToken !== this.playToken || this.current() !== song) return;
      if (played !== song) {
        q[this.index] = played;
        this.save();
      }
      let playbackUrl = url;
      if (played.source === 'youtube') {
        // YouTube 走整段缓冲：渐进式 range 播放在部分浏览器拿不到 duration
        const blob = await this.fetchAudioBlob(url);
        if (playToken !== this.playToken || this.current() !== played) return;
        playbackUrl = URL.createObjectURL(blob);
        this.mediaObjectUrl = playbackUrl;
      }
      audio.src = playbackUrl;
      audio.volume = this.volume;
      if (startAt > 0) {
        const seek = () => {
          try {
            audio.currentTime = startAt;
          } catch {}
        };
        audio.addEventListener('loadedmetadata', seek, { once: true });
      }
      this.loading = false;
      this.emit();
      if (autoplay) {
        try {
          await audio.play();
          this.failStreak = 0;
        } catch (e) {
          if ((e as Error)?.name === 'NotAllowedError') {
            this.emit();
            return;
          }
          this.handlePlaybackFailure(played, playToken);
        }
      }
    } catch (e) {
      console.warn('播放失败', e);
      this.loading = false;
      this.handlePlaybackFailure(song, playToken);
    }
  }

  private async fetchAudioBlob(url: string): Promise<Blob> {
    const requestUrl = url.includes('?') ? `${url}&nocache=${Date.now()}` : `${url}?nocache=${Date.now()}`;
    const res = await fetch(requestUrl, { credentials: 'include', headers: { Range: 'bytes=0-' } });
    if (!res.ok) throw new Error(`音频缓冲失败：HTTP ${res.status}`);
    return res.blob();
  }

  /**
   * 播放失败处理：丢弃缓存重新解析一次再放弃（短时效直链如酷狗 fs CDN 的
   * 403/过期单次重解析即可恢复），仍失败才提示并跳下一首。
   * 每首歌只重试一次（retriedSongKey 守卫），避免循环。
   */
  private handlePlaybackFailure(song: Song, playToken = this.playToken): void {
    if (!song || playToken !== this.playToken || this.current() !== song) return;
    if (this.failureHandledToken === playToken) return;
    this.failureHandledToken = playToken;
    const retriedKey = this.retriedSongKey;
    if (retriedKey !== songKey(song)) {
      this.retriedSongKey = songKey(song);
      const audio = this.audio;
      const wasPlaying = !!audio && !audio.paused;
      this.error = `「${song.name}」播放异常，正在重新解析播放地址…`;
      this.emit();
      void this.playIndex(this.index, wasPlaying, audio ? audio.currentTime || 0 : 0, {
        nocache: true,
        retry: true,
      }).catch(() => {});
      return;
    }
    this.error = `「${song.name}」无法播放，已跳过`;
    this.emit();
    const q = this.queue();
    this.failStreak += 1;
    if (this.failStreak >= 8 || q.length <= 1) {
      this.failStreak = 0;
      this.error = '多首歌曲播放失败，请检查网络或更换音乐源';
      this.emit();
      return;
    }
    setTimeout(() => {
      if (this.current() === song && this.failureHandledToken === playToken) this.next();
    }, 300);
  }

  private retriedSongKey = '';

  toggle(): void {
    const audio = this.audio;
    if (!audio) return;
    if (!audio.src) {
      if (this.index >= 0) void this.playIndex(this.index);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  next(auto = false): void {
    const q = this.queue();
    if (q.length === 0) return;
    const audio = this.audio;
    if (this.mode === 'repeat' && auto && audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    let i: number;
    if (this.mode === 'shuffle') {
      if (q.length === 1) i = 0;
      else {
        let r: number;
        do {
          r = Math.floor(Math.random() * q.length);
        } while (r === this.index);
        i = r;
      }
    } else {
      i = (this.index + 1) % q.length;
    }
    void this.playIndex(i);
  }

  prev(): void {
    const q = this.queue();
    if (q.length === 0) return;
    void this.playIndex((this.index - 1 + q.length) % q.length);
  }

  cycleMode(): PlayMode {
    const cycle: PlayMode[] = ['order', 'shuffle', 'repeat'];
    this.mode = cycle[(cycle.indexOf(this.mode) + 1) % cycle.length];
    this.save();
    this.emit();
    return this.mode;
  }

  seekTo(ratio: number): void {
    const audio = this.audio;
    if (audio && Number.isFinite(audio.duration)) {
      audio.currentTime = ratio * audio.duration;
      this.pendingPosition = audio.currentTime;
      this.save(0);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.audio) this.audio.volume = this.volume;
    this.save();
    this.emit();
  }

  clearError(): void {
    if (!this.error) return;
    this.error = '';
    this.emit();
  }

  /**
   * 系统媒体控制（MediaSession）：让锁屏 / 通知中心 / 键盘媒体键
   * 能显示当前曲目并控制播放，这是常驻播放器的基本预期。
   */
  private syncMediaSession(song: Song | null): void {
    const ms = typeof navigator === 'undefined' ? null : navigator.mediaSession;
    if (!ms) return;
    if (!song) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    const cover = this.picUrl(song, 300);
    try {
      ms.metadata = new MediaMetadata({
        title: song.name || '未知歌曲',
        artist: song.artist || '',
        album: song.album || '',
        artwork: cover ? [{ src: cover, sizes: '300x300', type: 'image/jpeg' }] : [],
      });
    } catch {
      // 部分浏览器无 MediaMetadata 构造器：跳过元数据，控件仍可用
    }
    if (this.mediaHandlersBound) return;
    this.mediaHandlersBound = true;
    const bind = (action: MediaSessionAction, handler: () => void) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // 浏览器不支持该动作
      }
    };
    bind('play', () => this.toggle());
    bind('pause', () => this.toggle());
    bind('previoustrack', () => this.prev());
    bind('nexttrack', () => this.next());
    bind('stop', () => this.stop());
  }

  private mediaHandlersBound = false;
  private mediaKey = '';

  /** emit 时同步系统媒体控件（换歌才重建元数据，避免每次 timeupdate 都重设） */
  private pushMediaSession(): void {
    const snap = this.snapshot;
    if (!snap) return;
    const key = snap.song ? songKey(snap.song) : '';
    if (key !== this.mediaKey) {
      this.mediaKey = key;
      this.syncMediaSession(snap.song);
    }
    const ms = typeof navigator === 'undefined' ? null : navigator.mediaSession;
    if (ms) ms.playbackState = snap.song ? (snap.playing ? 'playing' : 'paused') : 'none';
  }

  /** 供 iframe 内音乐应用同步的完整状态 */
  guestState(): Record<string, unknown> {
    const snap = this.getSnapshot();
    return {
      ready: snap.ready,
      playlists: snap.playlists,
      favorites: snap.favorites,
      temp: snap.temp,
      selectedPlaylistId: snap.selectedPlaylistId,
      queue: { type: snap.queueType, playlistId: snap.playlistId, index: snap.index },
      playback: {
        mode: snap.mode,
        playing: snap.playing,
        currentTime: snap.currentTime,
        duration: snap.duration,
        volume: snap.volume,
        loading: snap.loading,
      },
      ui: { dockMode: snap.dockMode, dockLastVisible: snap.dockLastVisible },
      error: snap.error,
    };
  }
}

declare global {
  interface Window {
    __meiMusicEngine?: MusicEngine;
  }
}

export function getMusicEngine(): MusicEngine {
  if (!window.__meiMusicEngine) window.__meiMusicEngine = new MusicEngine();
  return window.__meiMusicEngine;
}

export { songKey };
export type { MusicEngine };
