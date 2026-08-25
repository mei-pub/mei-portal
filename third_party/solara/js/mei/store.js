// Mei Music 状态中心：播放列表（多列表）/ 收藏 / 临时列表 / 事件总线
// 持久化：localStorage（主）+ /api/storage 远端同步（登录态跨设备）
import { remoteStorage } from "./api.js";

const LS_PLAYLISTS = "meiMusicPlaylists.v1";
const LS_FAVORITES = "favoriteSongs"; // 兼容旧版收藏键
const LS_SELECTED = "meiMusicSelectedList.v1";

const listeners = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}

export function songKey(song) {
  return `${song.source || "netease"}:${song.id}`;
}

export const store = {
  // 多播放列表：[{id, name, songs: []}]
  playlists: [],
  // 收藏：[song]
  favorites: [],
  // 临时列表（不持久化，req 10）
  temp: [],
  // 播放列表页当前选中的列表 id
  selectedPlaylistId: "",

  async init() {
    // 本地优先
    try {
      this.playlists = JSON.parse(localStorage.getItem(LS_PLAYLISTS) || "[]");
    } catch { this.playlists = []; }
    try {
      this.favorites = JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]");
    } catch { this.favorites = []; }
    this.selectedPlaylistId = localStorage.getItem(LS_SELECTED) || "";
    // 远端同步（覆盖本地，以远端为准合并：远端有则用远端）
    const remote = await remoteStorage.getItems([LS_PLAYLISTS, LS_FAVORITES]);
    if (remote) {
      if (remote[LS_PLAYLISTS]) {
        try {
          const list = typeof remote[LS_PLAYLISTS] === "string" ? JSON.parse(remote[LS_PLAYLISTS]) : remote[LS_PLAYLISTS];
          if (Array.isArray(list) && list.length >= this.playlists.length) this.playlists = list;
        } catch { /* ignore */ }
      }
      if (remote[LS_FAVORITES]) {
        try {
          const fav = typeof remote[LS_FAVORITES] === "string" ? JSON.parse(remote[LS_FAVORITES]) : remote[LS_FAVORITES];
          if (Array.isArray(fav)) this.favorites = fav;
        } catch { /* ignore */ }
      }
    }
    if (this.playlists.length === 0) {
      this.playlists = [{ id: `pl${Date.now()}`, name: "默认列表", songs: [] }];
      this.persistPlaylists();
    }
    if (!this.playlists.some((p) => p.id === this.selectedPlaylistId)) {
      this.selectedPlaylistId = this.playlists[0].id;
    }
    emit("store");
  },

  persistPlaylists() {
    localStorage.setItem(LS_PLAYLISTS, JSON.stringify(this.playlists));
    localStorage.setItem(LS_SELECTED, this.selectedPlaylistId);
    remoteStorage.setItems({ [LS_PLAYLISTS]: JSON.stringify(this.playlists) });
    emit("playlists");
  },
  persistFavorites() {
    localStorage.setItem(LS_FAVORITES, JSON.stringify(this.favorites));
    remoteStorage.setItems({ [LS_FAVORITES]: JSON.stringify(this.favorites) });
    emit("favorites");
  },

  // ============ 播放列表管理（新增/改名/删除/排序） ============
  getPlaylist(id) {
    return this.playlists.find((p) => p.id === id) || null;
  },
  createPlaylist(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const pl = { id: `pl${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: trimmed, songs: [] };
    this.playlists.push(pl);
    this.persistPlaylists();
    return pl;
  },
  renamePlaylist(id, name) {
    const pl = this.getPlaylist(id);
    const trimmed = String(name || "").trim();
    if (!pl || !trimmed) return;
    pl.name = trimmed;
    this.persistPlaylists();
  },
  deletePlaylist(id) {
    if (this.playlists.length <= 1) return false; // 至少保留一个
    this.playlists = this.playlists.filter((p) => p.id !== id);
    if (this.selectedPlaylistId === id) this.selectedPlaylistId = this.playlists[0]?.id || "";
    this.persistPlaylists();
    return true;
  },
  movePlaylist(id, dir) {
    const idx = this.playlists.findIndex((p) => p.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= this.playlists.length) return;
    const [pl] = this.playlists.splice(idx, 1);
    this.playlists.splice(to, 0, pl);
    this.persistPlaylists();
  },
  selectPlaylist(id) {
    if (this.getPlaylist(id)) {
      this.selectedPlaylistId = id;
      localStorage.setItem(LS_SELECTED, id);
      emit("playlists");
    }
  },

  // ============ 列表内歌曲（添加/删除/排序） ============
  addToPlaylist(id, song) {
    const pl = this.getPlaylist(id);
    if (!pl) return false;
    if (pl.songs.some((s) => songKey(s) === songKey(song))) return "exists";
    pl.songs.push({ ...song });
    this.persistPlaylists();
    return true;
  },
  removeFromPlaylist(id, key) {
    const pl = this.getPlaylist(id);
    if (!pl) return;
    pl.songs = pl.songs.filter((s) => songKey(s) !== key);
    this.persistPlaylists();
  },
  moveSongInPlaylist(id, index, dir) {
    const pl = this.getPlaylist(id);
    if (!pl) return;
    const to = index + dir;
    if (index < 0 || to < 0 || to >= pl.songs.length) return;
    const [s] = pl.songs.splice(index, 1);
    pl.songs.splice(to, 0, s);
    this.persistPlaylists();
  },

  // ============ 收藏 ============
  isFavorite(song) {
    return this.favorites.some((s) => songKey(s) === songKey(song));
  },
  isInAnyPlaylist(song) {
    return this.playlists.some((pl) => pl.songs.some((s) => songKey(s) === songKey(song)));
  },
  toggleFavorite(song) {
    const key = songKey(song);
    const idx = this.favorites.findIndex((s) => songKey(s) === key);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      this.persistFavorites();
      return false;
    }
    this.favorites.unshift({ ...song });
    this.persistFavorites();
    return true;
  },
  removeFavorite(key) {
    this.favorites = this.favorites.filter((s) => songKey(s) !== key);
    this.persistFavorites();
  },

  // ============ 临时列表（不持久化） ============
  setTemp(songs) {
    this.temp = songs.slice();
    emit("temp");
  },
  addToTemp(song) {
    if (this.temp.some((s) => songKey(s) === songKey(song))) return "exists";
    this.temp.push({ ...song });
    emit("temp");
    return true;
  },
};
