// Mei Music 抽象播放器组件（可复用）
// 核心：单一 Audio 实例 + 播放队列（临时列表 / 具体播放列表 / 我的收藏 三逻辑队列可切换）
// UI：底部悬浮播放条（mountBar 挂载到任意容器，多页面共享同一实例）
import { resolvePlayUrlWithFallback, picUrl } from "./api.js";
import { store, songKey, emit, on } from "./store.js";

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM18 6l-8.5 6L18 18z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>',
  order: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h12"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

const MODE_CYCLE = ["order", "shuffle", "repeat"];
const MODE_LABEL = { order: "顺序播放", shuffle: "随机播放", repeat: "单曲循环" };

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const player = {
  audio: new Audio(),
  queueType: "temp", // 'temp' | 'playlist' | 'fav'
  playlistId: "",
  index: -1,
  mode: "order",
  lyric: [],
  lyricIdx: -1,
  _barEl: null,
  _menuEl: null,

  init() {
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => this.next(true));
    this.audio.addEventListener("timeupdate", () => this._onTime());
    this.audio.addEventListener("play", () => emit("player"));
    this.audio.addEventListener("pause", () => emit("player"));
    this.audio.addEventListener("error", () => {
      emit("player");
    });
  },

  // 当前队列（实时引用 store，列表变更自动反映）
  queue() {
    if (this.queueType === "fav") return store.favorites;
    if (this.queueType === "playlist") {
      const pl = store.getPlaylist(this.playlistId);
      return pl ? pl.songs : [];
    }
    return store.temp;
  },
  queueLabel() {
    if (this.queueType === "fav") return "我的收藏";
    if (this.queueType === "playlist") {
      const pl = store.getPlaylist(this.playlistId);
      return pl ? pl.name : "播放列表";
    }
    return "临时列表";
  },
  current() {
    return this.queue()[this.index] || null;
  },

  // 切换队列来源并播放（type: temp/playlist/fav）
  setQueue(type, startIndex = 0, playlistId = "") {
    this.queueType = type;
    if (playlistId) this.playlistId = playlistId;
    if (type === "playlist" && !store.getPlaylist(this.playlistId)) {
      this.playlistId = store.playlists[0]?.id || "";
    }
    const q = this.queue();
    this.index = q.length > 0 ? Math.min(Math.max(startIndex, 0), q.length - 1) : -1;
    emit("queue");
    emit("player");
  },

  async playIndex(i, autoplay = true) {
    const q = this.queue();
    if (i < 0 || i >= q.length) return;
    this.index = i;
    const song = q[i];
    this.lyric = [];
    this.lyricIdx = -1;
    emit("queue");
    emit("player");
    try {
      const url = await resolvePlayUrlWithFallback(song, "320");
      // 竞态防护：解析期间用户已切歌
      if (this.current() !== song) return;
      this.audio.src = url;
      this._failStreak = 0;
      if (autoplay) await this.audio.play().catch(() => {});
    } catch (e) {
      console.warn("播放失败", e);
      emit("playerror", song);
      // 自动跳过不可播放歌曲（连败 8 首后停止，避免整列失效时死循环）
      if (this.current() === song) {
        this._failStreak = (this._failStreak || 0) + 1;
        if (this._failStreak >= 8 || q.length <= 1) {
          this._failStreak = 0;
          emit("playgiveup", song);
        } else {
          setTimeout(() => { if (this.current() === song) this.next(); }, 300);
        }
      }
    }
  },

  toggle() {
    if (!this.audio.src) {
      if (this.index >= 0) this.playIndex(this.index);
      return;
    }
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  },

  next(auto = false) {
    const q = this.queue();
    if (q.length === 0) return;
    if (this.mode === "repeat" && auto) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    let i;
    if (this.mode === "shuffle") {
      i = q.length === 1 ? 0 : (() => { let r; do { r = Math.floor(Math.random() * q.length); } while (r === this.index); return r; })();
    } else {
      i = (this.index + 1) % q.length;
    }
    this.playIndex(i);
  },

  prev() {
    const q = this.queue();
    if (q.length === 0) return;
    const i = (this.index - 1 + q.length) % q.length;
    this.playIndex(i);
  },

  cycleMode() {
    const i = MODE_CYCLE.indexOf(this.mode);
    this.mode = MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
    emit("player");
    return MODE_LABEL[this.mode];
  },

  seekTo(ratio) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = ratio * this.audio.duration;
    }
  },

  setLyric(lrcText) {
    const lines = String(lrcText || "").split("\n");
    const parsed = [];
    const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
    for (const line of lines) {
      const text = line.replace(re, "").trim();
      if (!text) continue;
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        parsed.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
      }
    }
    this.lyric = parsed;
    this.lyricIdx = -1;
    emit("lyric");
  },

  _onTime() {
    const t = this.audio.currentTime;
    if (this.lyric.length > 0) {
      let idx = -1;
      for (let k = 0; k < this.lyric.length; k++) {
        if (this.lyric[k].t <= t + 0.3) idx = k;
        else break;
      }
      if (idx !== this.lyricIdx) {
        this.lyricIdx = idx;
        emit("lyric");
      }
    }
    emit("time");
  },

  // ============ 底部播放条组件 ============
  mountBar(el, { onOpenPlayer } = {}) {
    this._barEl = el;
    this._onOpenPlayer = onOpenPlayer;
    const render = () => this._renderBar();
    ["player", "queue", "time", "favorites", "playlists", "temp"].forEach((ev) => on(ev, render));
    render();
  },

  _renderBar() {
    const el = this._barEl;
    if (!el) return;
    const song = this.current();
    if (!song) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const playing = !this.audio.paused;
    const dur = this.audio.duration;
    const cur = this.audio.currentTime;
    const cover = picUrl(song) || "";
    el.innerHTML = `
      <img class="b-cover" src="${cover}" alt="" onerror="this.style.visibility='hidden'">
      <div class="b-meta">
        <div class="b-name"></div>
        <div class="b-artist"></div>
      </div>
      <div class="b-controls">
        <button class="c-btn" data-act="mode" title="播放模式">${ICONS[this.mode]}</button>
        <button class="c-btn" data-act="prev" title="上一首">${ICONS.prev}</button>
        <button class="c-btn main" data-act="toggle" title="${playing ? "暂停" : "播放"}">${playing ? ICONS.pause : ICONS.play}</button>
        <button class="c-btn" data-act="next" title="下一首">${ICONS.next}</button>
      </div>
      <div class="b-progress">
        <span class="b-time">${fmt(cur)}</span>
        <input class="b-slider" type="range" min="0" max="1000" value="${Number.isFinite(dur) && dur > 0 ? Math.round((cur / dur) * 1000) : 0}">
        <span class="b-time">${fmt(dur)}</span>
      </div>
      <div class="b-right">
        <button class="b-list-tag" data-act="queue" title="当前播放队列（点击切换）"></button>
        <button class="c-btn" data-act="open" title="打开播放页">${ICONS.music}</button>
      </div>
    `;
    el.querySelector(".b-name").textContent = song.name;
    el.querySelector(".b-artist").textContent = `${song.artist}${song.album ? " · " + song.album : ""}`;
    el.querySelector(".b-list-tag").textContent = this.queueLabel();
    el.querySelector('[data-act="toggle"]').onclick = () => this.toggle();
    el.querySelector('[data-act="prev"]').onclick = () => this.prev();
    el.querySelector('[data-act="next"]').onclick = () => this.next();
    el.querySelector('[data-act="mode"]').onclick = () => this.cycleMode();
    el.querySelector('[data-act="open"]').onclick = () => this._onOpenPlayer && this._onOpenPlayer();
    el.querySelector(".b-cover").onclick = () => this._onOpenPlayer && this._onOpenPlayer();
    el.querySelector(".b-meta").onclick = () => this._onOpenPlayer && this._onOpenPlayer();
    el.querySelector('[data-act="queue"]').onclick = (e) => this._openQueueMenu(e.currentTarget);
    const slider = el.querySelector(".b-slider");
    slider.oninput = () => this.seekTo(slider.value / 1000);
  },

  // 队列切换弹层：临时列表 / 各播放列表 / 我的收藏（req 10）
  _openQueueMenu(anchor) {
    this._closeMenu();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "mei-popmenu";
    const items = [];
    items.push({ type: "temp", id: "", label: "临时列表", count: store.temp.length });
    for (const pl of store.playlists) {
      items.push({ type: "playlist", id: pl.id, label: pl.name, count: pl.songs.length });
    }
    items.push({ type: "fav", id: "", label: "我的收藏", count: store.favorites.length });
    menu.innerHTML = `<div class="m-title">切换播放队列</div>` + items.map((it) => `
      <button class="m-item ${this.queueType === it.type && (it.type !== "playlist" || this.playlistId === it.id) ? "active" : ""}" data-type="${it.type}" data-id="${it.id}">
        <span class="dot"></span><span></span><span class="cnt">${it.count} 首</span>
      </button>
    `).join("");
    const labels = menu.querySelectorAll(".m-item span:nth-child(2)");
    items.forEach((it, i) => { labels[i].textContent = it.label; });
    menu.querySelectorAll(".m-item").forEach((btn) => {
      btn.onclick = () => {
        this.setQueue(btn.dataset.type, 0, btn.dataset.id);
        if (this.index >= 0) this.playIndex(this.index);
        this._closeMenu();
      };
    });
    menu.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
    menu.style.bottom = window.innerHeight - rect.top + 8 + "px";
    document.body.appendChild(menu);
    this._menuEl = menu;
    setTimeout(() => {
      document.addEventListener("click", this._menuCloser = (e) => {
        if (!menu.contains(e.target)) this._closeMenu();
      });
    }, 0);
  },

  _closeMenu() {
    if (this._menuEl) {
      this._menuEl.remove();
      this._menuEl = null;
    }
    if (this._menuCloser) {
      document.removeEventListener("click", this._menuCloser);
      this._menuCloser = null;
    }
  },
};

export { ICONS, fmt, songKey };
