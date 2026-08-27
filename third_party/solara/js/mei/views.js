// Mei Music 视图渲染：搜索 / 播放列表管理 / 播放页 / 随便听听 / 我的收藏
import {
  createSearchRequestGuard,
  searchAggregate,
  sampleRandomSongs,
  radarPlaylist,
  picUrl,
  fetchLyric,
  downloadSong,
  sourceLabel,
  enabledSources,
} from "./api.js";
import { store, songKey, on, emit } from "./store.js";
import { player } from "./player.js";
import { I, toast, openDialog, confirmDialog, promptDialog } from "./ui.js";

const EXPLORE_GENRES = ["流行", "摇滚", "古典音乐", "民谣", "电子", "爵士", "说唱", "乡村", "蓝调", "R&B", "金属", "嘻哈", "轻音乐"];

function pickGenres(n) {
  let pool = EXPLORE_GENRES;
  try {
    const settings = JSON.parse(localStorage.getItem("radarSettings") || "null");
    if (settings && Array.isArray(settings.genres) && settings.genres.length > 0) pool = settings.genres;
  } catch { /* ignore */ }
  const copy = pool.slice();
  const out = [];
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dedupe(songs) {
  const seen = new Set();
  return songs.filter((s) => {
    const k = songKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ============ 品牌横幅（对齐工具箱首页 Hero） ============
function brandHtml() {
  return `
    <div class="mei-brand">
      <div class="row">
        <span class="tile">${I.music}</span>
        <span class="name">Mei Music</span>
      </div>
      <div class="desc">内置多音乐源聚合搜索，一个入口听全网</div>
    </div>
  `;
}

// ============ 搜索页（req 8 + req 9 指定列表模式） ============

let searchState = {
  keyword: "",
  source: "",
  results: [],
  page: 1,
  hasMore: false,
  loadingMore: false,
  loading: false,
  searched: false,
  targetListId: "",
};

let searchControls = { source: "" };
const searchRequests = createSearchRequestGuard();
let searchAutoObserver = null;

export async function renderSearch(root, targetListId = "") {
  searchState.targetListId = targetListId;
  const targetPl = targetListId ? store.getPlaylist(targetListId) : null;

  const draw = () => {
    const hasResults = searchState.searched;
    root.innerHTML = `
      <div class="mei-search-hero" style="${hasResults ? "padding-top:0" : ""}">
        ${hasResults ? "" : brandHtml()}
        <div class="mei-searchbox">
          <span class="s-icon">${I.search}</span>
          <input id="meiSearchInput" class="mei-input" placeholder="搜索歌名、歌手、专辑…" autocomplete="off">
          <select id="meiSearchSource" class="mei-source-select" aria-label="音乐源">
            <option value="" ${searchControls.source ? "" : "selected"}>全部源</option>
            ${enabledSources().map((source) => `<option value="${source.value}" ${searchControls.source === source.value ? "selected" : ""}>${source.label}</option>`).join("")}
          </select>
        </div>
        ${targetPl ? `
          <div class="mei-target-banner">
            ${I.list}
            <span>正在向播放列表 <b></b> 添加歌曲</span>
            <button class="x" id="meiTargetClear" title="退出添加模式">${I.x}</button>
          </div>
        ` : ""}
        ${hasResults ? "" : `
          <div class="mei-sources-hint">
            <span>聚合源：</span>
            ${enabledSources().map((s) => `<span class="chip">${s.label}</span>`).join("")}
          </div>
        `}
      </div>
      <div id="meiSearchOut" role="status" aria-live="polite"></div>
    `;
    if (targetPl) root.querySelector(".mei-target-banner b").textContent = targetPl.name;
    const input = root.querySelector("#meiSearchInput");
    const sourceSelect = root.querySelector("#meiSearchSource");
    input.value = searchState.keyword;
    if (!hasResults) setTimeout(() => input.focus(), 30);
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        const kw = input.value.trim();
        if (kw) doSearch(kw, sourceSelect.value);
      }
    };
    sourceSelect.onchange = () => {
      searchControls.source = sourceSelect.value;
      const kw = input.value.trim();
      if (kw) doSearch(kw, sourceSelect.value);
    };
    const clearBtn = root.querySelector("#meiTargetClear");
    if (clearBtn) clearBtn.onclick = () => { location.hash = "#/search"; };
    drawResults();
  };

  const doSearch = async (keyword, source = "") => {
    const request = searchRequests.begin();
    searchState.keyword = keyword;
    searchState.source = source;
    searchControls.source = source;
    searchState.loading = true;
    searchState.loadingMore = false;
    searchState.searched = true;
    searchState.results = [];
    searchState.page = 1;
    searchState.hasMore = false;
    draw();
    try {
      const results = await searchAggregate(keyword, 20, null, { source, page: 1 });
      if (!searchRequests.isCurrent(request)) return;
      searchState.results = dedupe(results);
      searchState.hasMore = searchState.results.length > 0;
    } catch (e) {
      if (!searchRequests.isCurrent(request)) return;
      console.error(e);
    }
    if (!searchRequests.isCurrent(request)) return;
    searchState.loading = false;
    drawResults();
  };

  const loadMore = async () => {
    if (!searchState.searched || searchState.loading || searchState.loadingMore || !searchState.hasMore) return;
    const request = searchRequests.begin();
    searchState.loadingMore = true;
    drawResults();
    try {
      const nextPage = searchState.page + 1;
      const results = await searchAggregate(searchState.keyword, 20, null, {
        source: searchState.source,
        page: nextPage,
      });
      if (!searchRequests.isCurrent(request)) return;
      const before = searchState.results.length;
      const merged = dedupe([...searchState.results, ...results]);
      searchState.results = merged;
      searchState.page = nextPage;
      searchState.hasMore = merged.length > before;
    } catch (e) {
      if (!searchRequests.isCurrent(request)) return;
      console.error(e);
      searchState.hasMore = false;
    }
    if (!searchRequests.isCurrent(request)) return;
    searchState.loadingMore = false;
    drawResults();
  };

  const observeAutoLoad = (out) => {
    if (searchAutoObserver) {
      searchAutoObserver.disconnect();
      searchAutoObserver = null;
    }
    const sentinel = out.querySelector("#meiSearchAutoLoader");
    if (!sentinel || !searchState.hasMore || searchState.loadingMore) return;
    searchAutoObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "160px 0px" });
    searchAutoObserver.observe(sentinel);
  };

  const drawResults = () => {
    const out = root.querySelector("#meiSearchOut");
    if (!out) return;
    if (searchAutoObserver) {
      searchAutoObserver.disconnect();
      searchAutoObserver = null;
    }
    if (!searchState.searched) {
      out.setAttribute("aria-busy", "false");
      out.innerHTML = "";
      return;
    }
    out.setAttribute("aria-busy", String(searchState.loading));
    if (searchState.loading) {
      const sourceCount = searchState.source ? 1 : enabledSources().length;
      out.innerHTML = `<div class="mei-loading"><span class="mei-spin"></span>正在${searchState.source ? `搜索 ${sourceLabel(searchState.source)}` : `聚合 ${sourceCount} 个音乐源`}搜索「${escapeHtml(searchState.keyword)}」…</div>`;
      return;
    }
    if (searchState.results.length === 0) {
      out.innerHTML = `
        <div class="mei-empty">
          <div class="e-icon">${I.search}</div>
          <div>没有找到匹配「${escapeHtml(searchState.keyword)}」的歌曲</div>
          <div style="margin-top:6px;font-size:12px;color:var(--faint)">换个关键词或音乐源试试</div>
        </div>
      `;
      return;
    }
    out.innerHTML = `
      <div class="mei-pagehead" style="margin-top:20px">
        <div>
          <h2>搜索结果</h2>
          <div class="sub">「${escapeHtml(searchState.keyword)}」共 ${searchState.results.length} 首，来自 ${new Set(searchState.results.map((s) => s.source)).size} 个音乐源</div>
        </div>
      </div>
      <div class="mei-grid">
        ${searchState.results.map((song, i) => songCardHtml(song, i)).join("")}
      </div>
      <div class="mei-load-more">
        <button id="meiLoadMore" class="mei-btn-ghost mei-btn-sm" ${searchState.hasMore ? "" : "disabled"}>
          ${searchState.loadingMore ? "正在加载…" : searchState.hasMore ? "加载更多" : "没有更多了"}
        </button>
      </div>
      <div id="meiSearchAutoLoader" aria-hidden="true"></div>
    `;
    const loadMoreBtn = out.querySelector("#meiLoadMore");
    if (loadMoreBtn) loadMoreBtn.onclick = loadMore;
    observeAutoLoad(out);
    out.querySelectorAll(".mei-song-card").forEach((card) => {
      const i = parseInt(card.dataset.idx, 10);
      const song = searchState.results[i];
      card.querySelector('[data-act="play"]').onclick = () => playSingle(song);
      card.querySelector('[data-act="fav"]').onclick = (e) => {
        const faved = store.toggleFavorite(song);
        e.currentTarget.classList.toggle("faved", faved);
        e.currentTarget.innerHTML = faved ? I.heartFill : I.heart;
        toast(faved ? "已加入收藏" : "已取消收藏");
      };
      card.querySelector('[data-act="add"]').onclick = (e) => {
        if (searchState.targetListId) {
          const r = store.addToPlaylist(searchState.targetListId, song);
          toast(r === "exists" ? "该歌曲已在列表中" : `已加入「${store.getPlaylist(searchState.targetListId)?.name || "列表"}」`);
        } else {
          openAddToListMenu(e.currentTarget, song);
        }
      };
      card.querySelector('[data-act="dl"]').onclick = async () => {
        toast("正在解析下载地址…");
        try {
          await downloadSong(song, "320");
        } catch {
          toast("下载失败，请稍后重试");
        }
      };
    });
  };

  draw();
}

function songCardHtml(song, i) {
  const faved = store.isFavorite(song);
  return `
    <div class="mei-song-card" data-idx="${i}">
      <div class="cover">
        <img src="${picUrl(song)}" alt="" loading="lazy" onerror="this.style.opacity='0'">
        <button class="play-veil" data-act="play" title="播放"><span>${I.play}</span></button>
      </div>
      <div class="meta">
        <div class="s-name" title="${escapeHtml(song.name)}">${escapeHtml(song.name)}</div>
        <div class="s-sub" title="${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""}">${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""}</div>
      </div>
      <div class="s-foot">
        <span class="s-src">${sourceLabel(song.source)}</span>
        <span class="s-actions">
          <button class="mei-icon-btn" data-act="add" title="添加到播放列表">${I.plus}</button>
          <button class="mei-icon-btn ${faved ? "faved" : ""}" data-act="fav" title="${faved ? "取消收藏" : "收藏"}">${faved ? I.heartFill : I.heart}</button>
          <button class="mei-icon-btn" data-act="dl" title="下载">${I.download}</button>
        </span>
      </div>
    </div>
  `;
}

// 单曲播放：放入临时列表并播放
export function playSingle(song) {
  const r = store.addToTemp(song);
  const idx = store.temp.findIndex((s) => songKey(s) === songKey(song));
  player.setQueue("temp", idx >= 0 ? idx : 0);
  player.playIndex(player.index);
}

// 添加到播放列表弹层：选择列表 / 快速新建 / 加入临时列表（req 9 非指定模式）
function openAddToListMenu(anchor, song) {
  document.querySelectorAll(".mei-popmenu").forEach((m) => m.remove());
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "mei-popmenu";
  menu.innerHTML = `
    <div class="m-title">添加到播放列表</div>
    <button class="m-item" data-act="temp"><span class="dot"></span><span>临时列表</span><span class="cnt">${store.temp.length} 首</span></button>
    ${store.playlists.map((pl) => `
      <button class="m-item" data-pl="${pl.id}"><span class="dot"></span><span>${escapeHtml(pl.name)}</span><span class="cnt">${pl.songs.length} 首</span></button>
    `).join("")}
    <div class="m-new">
      <input class="mei-input" placeholder="新建列表名称">
      <button class="mei-btn mei-btn-sm">新建</button>
    </div>
  `;
  menu.querySelector('[data-act="temp"]').onclick = () => {
    const r = store.addToTemp(song);
    toast(r === "exists" ? "已在临时列表中" : "已加入临时列表");
    menu.remove();
  };
  menu.querySelectorAll("[data-pl]").forEach((btn) => {
    btn.onclick = () => {
      const r = store.addToPlaylist(btn.dataset.pl, song);
      toast(r === "exists" ? "该歌曲已在列表中" : `已加入「${store.getPlaylist(btn.dataset.pl)?.name}」`);
      menu.remove();
    };
  });
  const newInput = menu.querySelector(".m-new input");
  const doCreate = () => {
    const name = newInput.value.trim();
    if (!name) return;
    const pl = store.createPlaylist(name);
    if (pl) {
      store.addToPlaylist(pl.id, song);
      toast(`已创建「${pl.name}」并加入该歌曲`);
    }
    menu.remove();
  };
  menu.querySelector(".m-new .mei-btn").onclick = doCreate;
  newInput.onkeydown = (e) => { if (e.key === "Enter") doCreate(); };
  menu.style.left = Math.min(rect.left - 100, window.innerWidth - 230) + "px";
  menu.style.top = Math.min(rect.bottom + 6, window.innerHeight - 280) + "px";
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("click", function closer(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", closer);
      }
    });
  }, 0);
}

// ============ 播放列表管理页（req 9） ============
export function renderPlaylists(root) {
  const draw = () => {
    const selected = store.getPlaylist(store.selectedPlaylistId) || store.playlists[0];
    root.innerHTML = `
      <div class="mei-pagehead">
        <div>
          <h2>播放列表</h2>
          <div class="sub">管理你的列表与列表内歌曲，共 ${store.playlists.length} 个列表</div>
        </div>
      </div>
      <div class="mei-pl-layout">
        <aside class="mei-card mei-pl-side">
          <div class="pl-new">
            <input class="mei-input" id="plNewName" placeholder="新列表名称">
            <button class="mei-btn mei-btn-sm icon-only" id="plNewBtn" title="创建列表">${I.plus}</button>
          </div>
          <div id="plItems"></div>
        </aside>
        <section class="mei-card mei-pl-main" id="plMain"></section>
      </div>
    `;

    // 左侧列表
    const items = root.querySelector("#plItems");
    items.innerHTML = store.playlists.map((pl) => `
      <div class="mei-pl-item ${selected && pl.id === selected.id ? "active" : ""}" data-id="${pl.id}">
        <span class="pl-ic">${I.list}</span>
        <span class="pl-name" title="${escapeHtml(pl.name)}">${escapeHtml(pl.name)}</span>
        <span class="pl-count">${pl.songs.length}</span>
        <span class="pl-ops">
          <button class="mei-icon-btn" data-op="up" title="上移">${I.up}</button>
          <button class="mei-icon-btn" data-op="down" title="下移">${I.down}</button>
          <button class="mei-icon-btn" data-op="rename" title="改名">${I.edit}</button>
          <button class="mei-icon-btn danger" data-op="del" title="删除">${I.trash}</button>
        </span>
      </div>
    `).join("");
    items.querySelectorAll(".mei-pl-item").forEach((el) => {
      const id = el.dataset.id;
      el.onclick = () => { store.selectPlaylist(id); };
      el.querySelector('[data-op="up"]').onclick = (e) => { e.stopPropagation(); store.movePlaylist(id, -1); };
      el.querySelector('[data-op="down"]').onclick = (e) => { e.stopPropagation(); store.movePlaylist(id, 1); };
      el.querySelector('[data-op="rename"]').onclick = async (e) => {
        e.stopPropagation();
        const pl = store.getPlaylist(id);
        const name = await promptDialog("修改列表名称", pl?.name || "");
        if (name) store.renamePlaylist(id, name);
      };
      el.querySelector('[data-op="del"]').onclick = async (e) => {
        e.stopPropagation();
        const pl = store.getPlaylist(id);
        if (store.playlists.length <= 1) { toast("至少保留一个播放列表"); return; }
        if (await confirmDialog(`删除播放列表「${pl?.name}」？列表内 ${pl?.songs.length || 0} 首歌曲将一并移除。`, { danger: true, okText: "删除" })) {
          store.deletePlaylist(id);
        }
      };
    });

    // 新建
    const newInput = root.querySelector("#plNewName");
    const doCreate = () => {
      const pl = store.createPlaylist(newInput.value);
      if (pl) {
        newInput.value = "";
        store.selectPlaylist(pl.id);
        toast(`已创建「${pl.name}」`);
      }
    };
    root.querySelector("#plNewBtn").onclick = doCreate;
    newInput.onkeydown = (e) => { if (e.key === "Enter") doCreate(); };

    // 右侧：选中列表的歌曲
    const main = root.querySelector("#plMain");
    if (!selected) {
      main.innerHTML = `<div class="mei-empty"><div class="e-icon">${I.list}</div><div>暂无播放列表</div></div>`;
      return;
    }
    main.innerHTML = `
      <div class="mei-pl-head">
        <div class="t">${escapeHtml(selected.name)} <span style="font-size:11px;color:var(--faint);font-weight:400">${selected.songs.length} 首</span></div>
        <div class="ops">
          <button class="mei-btn-ghost mei-btn-sm icon-only" id="plAddSongs" title="添加歌曲">${I.plus}</button>
          <button class="mei-btn mei-btn-sm icon-only" id="plPlayAll" title="播放全部" ${selected.songs.length === 0 ? "disabled" : ""}>${I.play}</button>
        </div>
      </div>
      <div id="plSongs"></div>
    `;
    main.querySelector("#plAddSongs").onclick = () => { location.hash = `#/search?list=${selected.id}`; };
    main.querySelector("#plPlayAll").onclick = () => {
      player.setQueue("playlist", 0, selected.id);
      player.playIndex(0);
      location.hash = "#/player";
    };

    const songsBox = main.querySelector("#plSongs");
    if (selected.songs.length === 0) {
      songsBox.innerHTML = `
        <div class="mei-empty">
          <div class="e-icon">${I.music}</div>
          <div>列表还是空的</div>
          <div style="margin-top:6px;font-size:12px;color:var(--faint)">点击上方「添加歌曲」从聚合搜索中加入</div>
        </div>
      `;
      return;
    }
    songsBox.innerHTML = selected.songs.map((song, i) => songRowHtml(song, i, {
      playing: player.queueType === "playlist" && player.playlistId === selected.id && player.index === i,
    })).join("");
    songsBox.querySelectorAll(".mei-song-row").forEach((row) => {
      const i = parseInt(row.dataset.idx, 10);
      const song = selected.songs[i];
      row.querySelector('[data-act="play"]').onclick = () => {
        player.setQueue("playlist", i, selected.id);
        player.playIndex(i);
        draw();
      };
      row.querySelector('[data-act="up"]').onclick = () => store.moveSongInPlaylist(selected.id, i, -1);
      row.querySelector('[data-act="down"]').onclick = () => store.moveSongInPlaylist(selected.id, i, 1);
      row.querySelector('[data-act="del"]').onclick = () => store.removeFromPlaylist(selected.id, songKey(song));
    });
  };

  draw();
}

function songRowHtml(song, i, { playing = false, showSort = true, showFav = false } = {}) {
  return `
    <div class="mei-song-row ${playing ? "playing" : ""}" data-idx="${i}">
      <span class="r-idx">${i + 1}</span>
      <img class="r-cover" src="${picUrl(song)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="r-meta">
        <div class="r-name">${escapeHtml(song.name)}</div>
        <div class="r-sub">${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""}</div>
      </div>
      <span class="r-src">${sourceLabel(song.source)}</span>
      <div class="r-ops">
        <button class="mei-icon-btn" data-act="play" title="播放">${I.play}</button>
        ${showSort ? `<button class="mei-icon-btn" data-act="up" title="上移">${I.up}</button>` : ""}
        ${showSort ? `<button class="mei-icon-btn" data-act="down" title="下移">${I.down}</button>` : ""}
        ${showFav ? `<button class="mei-icon-btn danger" data-act="unfav" title="取消收藏">${I.heartFill}</button>` : ""}
        <button class="mei-icon-btn danger" data-act="del" title="移除">${I.x}</button>
      </div>
    </div>
  `;
}

// ============ 播放页（req 10：三逻辑队列切换） ============
let playerPageMounted = false;
let playerViewMode = "disc"; // disc：封面唱片 / lyric：歌词播放

export function renderPlayer(root) {
  const song = player.current();
  if (!song) {
    root.innerHTML = `
      <div class="mei-empty" style="padding-top:14vh">
        <div class="e-icon">${I.music}</div>
        <div>还没有正在播放的音乐</div>
        <div style="margin:6px 0 18px;font-size:12px;color:var(--faint)">去搜索一首歌，或从随便听听开始</div>
        <div style="display:flex;gap:10px;justify-content:center">
          <a class="mei-btn" href="#/search">${I.search} 搜索音乐</a>
          <a class="mei-btn-ghost" href="#/random">${I.shuffle} 随便听听</a>
        </div>
      </div>
    `;
    return;
  }

  const queue = player.queue();
  const isLyricMode = playerViewMode === "lyric";
  root.innerHTML = `
    <div class="mei-player-page">
      <div class="mei-stage">
        ${isLyricMode ? `
          <div class="lyric-full">
            <button class="view-toggle" id="meiViewToggle" title="切换封面唱片">${I.disc}</button>
            <div class="p-title">${escapeHtml(song.name)}</div>
            <div class="p-sub">${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""} · ${sourceLabel(song.source)}</div>
            <div class="mei-lyric-box big" id="meiLyric"><div class="l-line">♪</div></div>
          </div>
        ` : `
          <div class="vinyl-wrap">
            <div class="vinyl ${player.audio.paused ? "" : "spin"}" id="meiVinyl" aria-hidden="true">
              <div class="disc">
                <img class="big-cover" src="${picUrl(song, 500)}" alt="" onerror="this.style.opacity='0.3'">
                <div class="hole"></div>
              </div>
            </div>
            <button class="view-toggle" id="meiViewToggle" title="切换歌词播放">${I.list}</button>
          </div>
          <div class="p-title">${escapeHtml(song.name)}</div>
          <div class="p-sub">${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""} · ${sourceLabel(song.source)}</div>
          <div class="mei-lyric-box" id="meiLyric"><div class="l-line">♪</div></div>
        `}
      </div>
      <div class="mei-card mei-queue">
        <div class="q-tabs" id="qTabs"></div>
        <div class="q-list" id="qList"></div>
      </div>
    </div>
  `;

  // 封面唱片 / 歌词播放切换
  root.querySelector("#meiViewToggle").onclick = () => {
    playerViewMode = isLyricMode ? "disc" : "lyric";
    renderPlayer(root);
  };

  // 队列 tabs：临时列表 / 当前播放列表 / 我的收藏
  const tabs = root.querySelector("#qTabs");
  const curPl = player.queueType === "playlist" ? store.getPlaylist(player.playlistId) : store.getPlaylist(store.selectedPlaylistId);
  const tabDefs = [
    { type: "temp", id: "", label: "临时列表", count: store.temp.length },
    ...(curPl ? [{ type: "playlist", id: curPl.id, label: curPl.name, count: curPl.songs.length }] : []),
    { type: "fav", id: "", label: "我的收藏", count: store.favorites.length },
  ];
  tabs.innerHTML = tabDefs.map((t) => `
    <button class="q-tab ${player.queueType === t.type ? "active" : ""}" data-type="${t.type}" data-id="${t.id}">
      ${escapeHtml(t.label)} · ${t.count}
    </button>
  `).join("");
  tabs.querySelectorAll(".q-tab").forEach((btn) => {
    btn.onclick = () => {
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      const q = type === "temp" ? store.temp : type === "fav" ? store.favorites : (store.getPlaylist(id)?.songs || []);
      if (q.length === 0) { toast("该列表暂无歌曲"); return; }
      player.setQueue(type, 0, id);
      player.playIndex(0);
      loadLyric();
    };
  });

  // 队列歌曲
  const list = root.querySelector("#qList");
  if (queue.length === 0) {
    list.innerHTML = `<div class="mei-empty" style="padding:30px"><div>当前队列为空</div></div>`;
  } else {
    list.innerHTML = queue.map((s, i) => songRowHtml(s, i, {
      playing: i === player.index,
      showSort: false,
    })).join("");
    list.querySelectorAll(".mei-song-row").forEach((row) => {
      const i = parseInt(row.dataset.idx, 10);
      row.querySelector('[data-act="play"]').onclick = () => { player.playIndex(i); loadLyric(); };
      const del = row.querySelector('[data-act="del"]');
      if (del) del.onclick = () => {
        const s = queue[i];
        if (player.queueType === "fav") store.removeFavorite(songKey(s));
        else if (player.queueType === "playlist") store.removeFromPlaylist(player.playlistId, songKey(s));
        else {
          store.temp.splice(i, 1);
          emit("temp");
        }
      };
    });
  }

  // 歌词
  const lyricBox = root.querySelector("#meiLyric");
  const drawLyric = () => {
    if (!lyricBox.isConnected) return;
    if (player.lyric.length === 0) {
      lyricBox.innerHTML = `<div class="l-line">纯音乐，请欣赏</div>`;
      return;
    }
    const idx = player.lyricIdx;
    const from = Math.max(0, idx - 1);
    const slice = player.lyric.slice(from, from + 4);
    lyricBox.innerHTML = slice.map((l, k) => `<div class="l-line ${from + k === idx ? "on" : ""}">${escapeHtml(l.text)}</div>`).join("");
  };
  drawLyric();

  // 唱片转动状态随播放/暂停切换
  const vinyl = root.querySelector("#meiVinyl");
  const syncVinyl = () => {
    const el = document.getElementById("meiVinyl");
    if (el) el.classList.toggle("spin", !player.audio.paused);
  };
  syncVinyl();
  on("player", syncVinyl);

  if (!playerPageMounted) {
    playerPageMounted = true;
    on("lyric", () => {
      const box = document.getElementById("meiLyric");
      if (box) drawLyricOf(box);
    });
  }
  function drawLyricOf(box) {
    if (player.lyric.length === 0) {
      box.innerHTML = `<div class="l-line">纯音乐，请欣赏</div>`;
      return;
    }
    const idx = player.lyricIdx;
    const from = Math.max(0, idx - 1);
    const slice = player.lyric.slice(from, from + 4);
    box.innerHTML = slice.map((l, k) => `<div class="l-line ${from + k === idx ? "on" : ""}">${escapeHtml(l.text)}</div>`).join("");
  }
}

// 歌词加载（播放页进入与切歌时调用）
export async function loadLyric() {
  const song = player.current();
  if (!song) return;
  try {
    const lrc = await fetchLyric(song);
    if (player.current() === song) player.setLyric(lrc || "");
  } catch {
    if (player.current() === song) player.setLyric("");
  }
}

// ============ 随便听听（req 11） ============
export function renderRandom(root) {
  root.innerHTML = `
    <div class="mei-search-hero" style="padding-top:16vh">
      ${brandHtml()}
      <div class="mei-loading" style="padding:20px">
        <span class="mei-spin"></span>
        <span id="randTip">正在从聚合源随机挑选 200 首歌…</span>
      </div>
    </div>
  `;
  (async () => {
    try {
      const keywords = pickGenres(8);
      let songs = dedupe(await sampleRandomSongs(keywords, 30));
      if (songs.length < 40) {
        // 聚合采样不足：雷达歌单兜底
        const radar = await radarPlaylist("3778678", 200).catch(() => []);
        songs = dedupe([...songs, ...radar]);
      }
      if (songs.length === 0) throw new Error("empty");
      const picked = shuffle(songs).slice(0, 200);
      store.setTemp(picked);
      player.setQueue("temp", 0);
      player.mode = "shuffle";
      player.playIndex(0);
      loadLyric();
      toast(`已随机挑选 ${picked.length} 首歌，随机播放中`);
      location.hash = "#/player";
    } catch {
      root.querySelector("#randTip").textContent = "随机获取失败，请检查音乐源后重试";
    }
  })();
}

// ============ 我的收藏（req 12） ============
export function renderFavorites(root) {
  if (store.favorites.length === 0) {
    root.innerHTML = `
      <div class="mei-empty" style="padding-top:14vh">
        <div class="e-icon">${I.heart}</div>
        <div>还没有收藏的歌曲</div>
        <div style="margin:6px 0 18px;font-size:12px;color:var(--faint)">在搜索结果中点击心形图标收藏喜欢的歌</div>
        <a class="mei-btn" href="#/search">${I.search} 去搜索</a>
      </div>
    `;
    return;
  }
  // 进入收藏列表播放模式
  if (player.queueType !== "fav") {
    player.setQueue("fav", 0);
    player.playIndex(0);
    loadLyric();
  }
  location.hash = "#/player";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
