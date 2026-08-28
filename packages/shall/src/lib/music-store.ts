// 账户级音乐状态（$DATA_DIR/shell/music/<uid>.json）
// 存播放列表 / 收藏 / 当前队列 / 播放进度 / 播放模式 / 播放条收起态。
// 与 panel-store 的区别：这里的数据是用户不可重建的资产（收藏、列表），
// 读取异常必须显式抛出，绝不静默返回默认值覆盖掉真实数据。
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const MUSIC_DIR = path.join(DATA_DIR, 'shell', 'music');

const MAX_SONGS_PER_LIST = 2000;
const MAX_PLAYLISTS = 60;
const MAX_FAVORITES = 5000;
const MAX_QUEUE = 2000;

export type QueueType = 'temp' | 'playlist' | 'fav';
export type PlayMode = 'order' | 'shuffle' | 'repeat';
/** 播放条形态：完整 / 缩小 / 隐藏（隐藏态仅留贴底把手） */
export type DockMode = 'full' | 'mini' | 'hidden';
const DOCK_MODES: DockMode[] = ['full', 'mini', 'hidden'];

export interface MusicSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  pic_id: string;
  lyric_id: string;
  source: string;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  songs: MusicSong[];
}

export interface MusicState {
  revision: number;
  updatedAt: string;
  playlists: MusicPlaylist[];
  favorites: MusicSong[];
  selectedPlaylistId: string;
  temp: MusicSong[];
  queue: {
    type: QueueType;
    playlistId: string;
    index: number;
  };
  playback: {
    mode: PlayMode;
    position: number; // 秒
    volume: number; // 0~1
  };
  ui: {
    dockMode: DockMode;
    /** 上一次的可见形态，隐藏态展开时回到它 */
    dockLastVisible: Exclude<DockMode, 'hidden'>;
  };
}

export const DEFAULT_STATE: MusicState = {
  revision: 0,
  updatedAt: '',
  playlists: [],
  favorites: [],
  selectedPlaylistId: '',
  temp: [],
  queue: { type: 'temp', playlistId: '', index: -1 },
  playback: { mode: 'order', position: 0, volume: 1 },
  ui: { dockMode: 'full', dockLastVisible: 'full' },
};

function str(v: unknown, maxLen: number, dft = ''): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, maxLen);
  if (typeof v !== 'string') return dft;
  return v.slice(0, maxLen);
}

function num(v: unknown, min: number, max: number, dft: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

function normalizeSong(raw: unknown): MusicSong | null {
  const s = (raw || {}) as Record<string, unknown>;
  const id = str(s.id, 200);
  if (!id) return null;
  return {
    id,
    name: str(s.name, 200, '未知歌曲'),
    artist: str(s.artist, 200, ''),
    album: str(s.album, 200, ''),
    pic_id: str(s.pic_id, 400, ''),
    lyric_id: str(s.lyric_id, 200, id),
    source: str(s.source, 40, 'netease'),
  };
}

function normalizeSongs(raw: unknown, cap: number): MusicSong[] {
  if (!Array.isArray(raw)) return [];
  const out: MusicSong[] = [];
  for (const item of raw.slice(0, cap)) {
    const song = normalizeSong(item);
    if (song) out.push(song);
  }
  return out;
}

export function normalizeState(raw: unknown): MusicState {
  const r = (raw || {}) as Record<string, unknown>;
  const queue = (r.queue || {}) as Record<string, unknown>;
  const playback = (r.playback || {}) as Record<string, unknown>;
  const ui = (r.ui || {}) as Record<string, unknown>;
  const playlists = (Array.isArray(r.playlists) ? r.playlists : [])
    .slice(0, MAX_PLAYLISTS)
    .map((raw, i) => {
      const pl = (raw || {}) as Record<string, unknown>;
      return {
        id: str(pl.id, 60, `pl${i}`),
        name: str(pl.name, 60, '未命名列表'),
        songs: normalizeSongs(pl.songs, MAX_SONGS_PER_LIST),
      };
    })
    .filter((pl) => pl.id);
  const queueType: QueueType = queue.type === 'playlist' || queue.type === 'fav' ? queue.type : 'temp';
  const mode: PlayMode =
    playback.mode === 'shuffle' || playback.mode === 'repeat' ? playback.mode : 'order';
  return {
    revision: Math.max(0, Math.floor(num(r.revision, 0, Number.MAX_SAFE_INTEGER, 0))),
    updatedAt: str(r.updatedAt, 40),
    playlists,
    favorites: normalizeSongs(r.favorites, MAX_FAVORITES),
    selectedPlaylistId: str(r.selectedPlaylistId, 60),
    temp: normalizeSongs(r.temp, MAX_QUEUE),
    queue: {
      type: queueType,
      playlistId: str(queue.playlistId, 60),
      index: Math.floor(num(queue.index, -1, MAX_QUEUE, -1)),
    },
    playback: {
      mode,
      position: num(playback.position, 0, 24 * 3600, 0),
      volume: num(playback.volume, 0, 1, 1),
    },
    ui: normalizeUi(ui),
  };
}

/** 播放条形态归一化，并兼容旧版布尔字段 dockCollapsed */
function normalizeUi(ui: Record<string, unknown>): MusicState['ui'] {
  let mode = DOCK_MODES.includes(ui.dockMode as DockMode) ? (ui.dockMode as DockMode) : null;
  if (!mode && 'dockCollapsed' in ui) mode = ui.dockCollapsed === true ? 'hidden' : 'full';
  const last = ui.dockLastVisible === 'mini' ? 'mini' : 'full';
  return {
    dockMode: mode || 'full',
    // 可见形态本身即为「上一次可见形态」，避免展开时回到过期值
    dockLastVisible: mode && mode !== 'hidden' ? mode : last,
  };
}

function stateFile(uid: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(uid)) throw new Error('非法账户标识');
  return path.join(MUSIC_DIR, `${uid}.json`);
}

/** 读取账户音乐状态；文件不存在返回默认值，损坏则抛错（不静默丢数据） */
export function getMusicState(uid: string): MusicState {
  const file = stateFile(uid);
  if (!fs.existsSync(file)) return { ...DEFAULT_STATE };
  const raw = fs.readFileSync(file, 'utf8');
  return normalizeState(JSON.parse(raw));
}

/** 原子写入（先写临时文件再 rename，避免并发写出半截 JSON） */
export function saveMusicState(uid: string, state: MusicState): MusicState {
  const file = stateFile(uid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: MusicState = {
    ...state,
    revision: state.revision,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

/**
 * 合并保存：只覆盖 patch 中出现的顶层字段，并做乐观并发校验。
 * patch.revision 落后于已存状态时视为冲突（调用方需先取最新再重试）。
 */
export function patchMusicState(
  uid: string,
  patch: Record<string, unknown>
): { ok: true; state: MusicState } | { ok: false; conflict: true; state: MusicState } {
  const current = getMusicState(uid);
  const clientRevision = Number(patch.revision);
  if (Number.isFinite(clientRevision) && clientRevision < current.revision) {
    return { ok: false, conflict: true, state: current };
  }
  const merged = normalizeState({
    ...current,
    ...patch,
    queue: { ...current.queue, ...((patch.queue as object) || {}) },
    playback: { ...current.playback, ...((patch.playback as object) || {}) },
    ui: { ...current.ui, ...((patch.ui as object) || {}) },
    revision: current.revision + 1,
  });
  return { ok: true, state: saveMusicState(uid, merged) };
}
