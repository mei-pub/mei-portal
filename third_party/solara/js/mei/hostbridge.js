// 宿主桥接：音乐应用被门户外壳以 iframe 承载时，把播放能力委托给外壳常驻播放引擎。
// 目的：切换子应用（影视/绘图/下载…）时音频不中断——Audio 实例活在外壳页面里，
// iframe 只负责 UI 与数据编辑，播放控制通过 postMessage 交给外壳。
//
// 未被 iframe 承载（直接访问 /music/）时 enabled=false，播放器保持本地单例行为。
import { store, emit } from "./store.js";
import { player } from "./player.js";

const HOST_SOURCE = "mei-music-host";
const GUEST_SOURCE = "mei-music-guest";

function inFrame() {
  try {
    return window.parent && window.parent !== window;
  } catch {
    return false;
  }
}

export const hostBridge = {
  enabled: false,
  connected: false,

  send(message) {
    if (!this.enabled) return;
    try {
      window.parent.postMessage({ source: GUEST_SOURCE, ...message }, window.location.origin);
    } catch {
      /* 跨域或父窗口消失：忽略 */
    }
  },

  /** 尝试连接外壳；返回是否进入宿主模式 */
  connect() {
    if (!inFrame()) return false;
    this.enabled = true;
    player.enableHostMode(this);
    window.addEventListener("message", (ev) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data;
      if (!data || data.source !== HOST_SOURCE || data.type !== "state") return;
      this.connected = true;
      applyState(data.state || {});
    });
    this.send({ type: "hello" });
    // iframe 内的按键不会冒泡到外壳，Alt+M 需要显式转发才能切播放条形态
    window.addEventListener("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || String(e.key).toLowerCase() !== "m") return;
      const el = e.target;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      this.send({ type: "cycle-dock-mode" });
    });
    return true;
  },

  /** 数据变更（列表/收藏/临时列表）同步给外壳，由外壳统一持久化到账户 */
  pushData() {
    this.send({
      type: "replace-data",
      data: {
        playlists: store.playlists,
        favorites: store.favorites,
        temp: store.temp,
        selectedPlaylistId: store.selectedPlaylistId,
      },
    });
  },

  /** 切换外壳播放条形态：full / mini / hidden */
  setDockMode(mode) {
    this.send({ type: "set-dock-mode", mode });
  },

  /** 播放页音量控制（宿主模式下音量由外壳 Audio 持有） */
  setVolume(v) {
    this.send({ type: "set-volume", volume: v });
  },
};

const DOCK_MODES = ["full", "mini", "hidden"];

/** 外壳播放条形态 → body class，让应用内底部留白随形态收缩 */
function applyDockMode(mode) {
  if (!DOCK_MODES.includes(mode)) return;
  DOCK_MODES.forEach((m) => document.body.classList.toggle("mei-dock-" + m, m === mode));
}

function sameSongList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i]?.source || "") !== (b[i]?.source || "") || String(a[i]?.id) !== String(b[i]?.id)) return false;
  }
  return true;
}

function applyState(state) {
  const queue = state.queue || {};
  const playback = state.playback || {};
  const ui = state.ui || {};
  if (ui.dockMode) applyDockMode(ui.dockMode);

  let dataChanged = false;
  if (Array.isArray(state.playlists)) {
    const changed =
      state.playlists.length !== store.playlists.length ||
      state.playlists.some((pl, i) => pl.id !== store.playlists[i]?.id || !sameSongList(pl.songs, store.playlists[i]?.songs));
    if (changed) {
      store.playlists = state.playlists;
      dataChanged = true;
      emit("playlists");
    }
  }
  if (Array.isArray(state.favorites) && !sameSongList(state.favorites, store.favorites)) {
    store.favorites = state.favorites;
    dataChanged = true;
    emit("favorites");
  }
  if (Array.isArray(state.temp) && !sameSongList(state.temp, store.temp)) {
    store.temp = state.temp;
    dataChanged = true;
    emit("temp");
  }
  if (typeof state.selectedPlaylistId === "string" && state.selectedPlaylistId) {
    store.selectedPlaylistId = state.selectedPlaylistId;
  }

  const queueChanged =
    player.queueType !== queue.type ||
    player.playlistId !== (queue.playlistId || "") ||
    player.index !== queue.index;
  if (queue.type) player.queueType = queue.type;
  if (typeof queue.playlistId === "string") player.playlistId = queue.playlistId;
  if (Number.isFinite(queue.index)) player.index = queue.index;
  if (playback.mode) player.mode = playback.mode;

  player.audio.paused = !playback.playing;
  player.audio.currentTime = Number(playback.currentTime) || 0;
  player.audio.duration = Number(playback.duration) || 0;
  // 音量/缓冲态镜像：播放页是完整播放器，需要展示并控制这些
  if (Number.isFinite(Number(playback.volume))) player.audio.volume = Number(playback.volume);
  player.loading = !!playback.loading;
  player.audio.src = playback.playing || player.index >= 0 ? "host" : "";

  if (queueChanged || dataChanged) emit("queue");
  emit("player");
  player.syncLyricIdx(player.audio.currentTime);
  emit("time");
}
