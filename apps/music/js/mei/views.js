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
  fetchDownloadLibrary,
  deleteDownloadFile,
  serverLocalSong,
} from "./api.js";
import { store, songKey, on, emit } from "./store.js";
import { player, PLAYER_ICONS as PI, MODE_LABELS, fmtTime } from "./player.js";
import { I, toast, openDialog, confirmDialog, promptDialog } from "./ui.js";
import { pushRoute } from "./router.js";

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

export async function renderSearch(root, params = new URLSearchParams()) {
  const routeParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || "");
  const targetListId = routeParams.get("list") || "";
  const initialQuery = routeParams.get("q") || "";
  const initialSource = routeParams.get("source") || "";
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
    if (clearBtn) clearBtn.onclick = () => { pushRoute("/search"); };
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
  if (initialQuery && searchState.keyword !== initialQuery) {
    await doSearch(initialQuery, initialSource);
  }
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
    main.querySelector("#plAddSongs").onclick = () => {
      pushRoute("/search", new URLSearchParams({ list: selected.id }));
    };
    main.querySelector("#plPlayAll").onclick = () => {
      player.setQueue("playlist", 0, selected.id);
      player.playIndex(0);
      pushRoute("/player");
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

// ============ 播放页 ============
// 定位区分（强约束）：
// - 播放「组件」= 门户常驻底部播放条（MusicDock / mei-playerbar）：跨应用后台播放
//   与最小控制，只渲染少量信息。
// - 播放「页」= 本视图：一个整体垂直居中的完整播放器，自带唱片滚动、歌词、进度、
//   全套播控（播放模式 / 上一首 / 播放暂停 / 下一首 / 音量 / 收藏 / 加入列表 /
//   下载）与队列，不依赖底部播放条即可完成全部操作。
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
  const playing = !player.audio.paused;
  const dur = player.audio.duration;
  const cur = player.audio.currentTime;
  const ratio = Number.isFinite(dur) && dur > 0 ? Math.round((cur / dur) * 1000) : 0;
  const faved = store.isFavorite(song);
  const vol = Number.isFinite(player.audio.volume) ? player.audio.volume : 1;
  const showAddList = player.queueType === "temp" && !store.isInAnyPlaylist(song);

  // 整体一个垂直居中的大组件：舞台（唱片/歌词）+ 曲目信息 + 进度 + 全套播控 + 队列
  root.innerHTML = `
    <div class="mei-player-page">
      <section class="mei-player-shell mei-card">
        <div class="pp-body">
          <div class="pp-stage">
            ${isLyricMode ? `
              <div class="lyric-full">
                <div class="mei-lyric-box big" id="meiLyric"><div class="l-line">♪</div></div>
              </div>
            ` : `
              <div class="vinyl-wrap">
                <div class="vinyl ${playing ? "spin" : ""}" id="meiVinyl" aria-hidden="true">
                  <div class="disc">
                    <img class="big-cover" src="${picUrl(song, 500)}" alt="" onerror="this.style.opacity='0.3'">
                    <div class="hole"></div>
                  </div>
                </div>
              </div>
            `}
          </div>

          <div class="pp-side">
            <div class="pp-head">
              <div class="pp-titles">
                <h2 class="p-title" title="${escapeHtml(song.name)}">${escapeHtml(song.name)}</h2>
                <div class="p-sub">${escapeHtml(song.artist)}${song.album ? " · " + escapeHtml(song.album) : ""}</div>
              </div>
              <span class="pp-src">${sourceLabel(song.source)}</span>
            </div>

            ${isLyricMode ? "" : `<div class="mei-lyric-box" id="meiLyricSide"><div class="l-line">♪</div></div>`}

            <div class="pp-progress">
              <span class="pp-time" id="ppCur">${fmtTime(cur)}</span>
              <input class="pp-slider" id="ppSeek" type="range" min="0" max="1000" value="${ratio}" aria-label="播放进度">
              <span class="pp-time" id="ppDur">${fmtTime(dur)}</span>
            </div>

            <div class="pp-controls">
              <button class="pp-btn" data-act="mode" title="${MODE_LABELS[player.mode] || "播放模式"}">${PI[player.mode]}</button>
              <button class="pp-btn" data-act="prev" title="上一首">${PI.prev}</button>
              <button class="pp-btn main" data-act="toggle" title="${playing ? "暂停" : "播放"}">${playing ? PI.pause : PI.play}</button>
              <button class="pp-btn" data-act="next" title="下一首">${PI.next}</button>
              <button class="pp-btn" id="ppViewToggle" title="${isLyricMode ? "切换封面唱片" : "切换歌词播放"}">${isLyricMode ? I.disc : I.list}</button>
            </div>

            <div class="pp-extra">
              <button class="pp-btn sm ${faved ? "faved" : ""}" data-act="fav" title="${faved ? "取消收藏" : "加入收藏"}">${faved ? PI.heartFill : PI.heart}</button>
              ${showAddList ? `<button class="pp-btn sm" data-act="add-list" title="添加到播放列表">${PI.plus}</button>` : ""}
              <button class="pp-btn sm" data-act="download" title="下载">${I.download}</button>
              <div class="pp-volume">
                <span class="pp-vol-icon" aria-hidden="true">${I.zap}</span>
                <input class="pp-slider vol" id="ppVol" type="range" min="0" max="100" value="${Math.round(vol * 100)}" aria-label="音量">
              </div>
            </div>
          </div>
        </div>

        <div class="pp-queue">
          <div class="q-tabs" id="qTabs"></div>
          <div class="q-list" id="qList"></div>
        </div>
      </section>
    </div>
  `;

  // ---- 播控绑定（宿主模式下 player 会把指令转发给外壳引擎）----
  const act = (name, fn) => {
    const el = root.querySelector(`[data-act="${name}"]`);
    if (el) el.onclick = fn;
  };
  act("toggle", () => player.toggle());
  act("prev", () => player.prev());
  act("next", () => player.next());
  act("mode", () => {
    const label = player.cycleMode();
    if (label) toast(label);
  });
  act("fav", () => {
    const added = store.toggleFavorite(song);
    toast(added ? "已加入收藏" : "已取消收藏");
  });
  act("download", () => downloadSong(song).catch(() => toast("下载失败")));
  const addListBtn = root.querySelector('[data-act="add-list"]');
  if (addListBtn) addListBtn.onclick = () => openAddToListMenu(addListBtn, song);

  const seek = root.querySelector("#ppSeek");
  seek.oninput = () => player.seekTo(seek.value / 1000);
  const volEl = root.querySelector("#ppVol");
  volEl.oninput = () => player.setVolume(volEl.value / 100);

  // 首帧对齐一次（后续由全局同步器驱动，见 playerPageMounted 分支）
  syncPlayerTime();
  syncPlayerControls();

  // 封面唱片 / 歌词播放切换
  root.querySelector("#ppViewToggle").onclick = () => {
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

  // 歌词：唱片模式渲染到侧栏小窗（#meiLyricSide），歌词模式渲染到舞台大窗（#meiLyric）
  drawLyricAll();
  // 全局同步器只注册一次：store.on 每次调用都会新增闭包，
  // 播放页会因切歌/列表变更反复重渲染，就地注册会导致监听器无上限累积。
  if (!playerPageMounted) {
    playerPageMounted = true;
    on("lyric", drawLyricAll);
    on("time", () => { syncPlayerTime(); });
    on("player", () => { syncPlayerControls(); });
  }
}

/** 进度与时间轻量刷新：不重建 DOM，避免封面闪烁与拖动被打断 */
function syncPlayerTime() {
  const s = document.getElementById("ppSeek");
  if (!s || !s.isConnected) return;
  const d = player.audio.duration;
  const c = player.audio.currentTime;
  if (document.activeElement !== s) {
    s.value = String(Number.isFinite(d) && d > 0 ? Math.round((c / d) * 1000) : 0);
  }
  const curEl = document.getElementById("ppCur");
  const durEl = document.getElementById("ppDur");
  if (curEl) curEl.textContent = fmtTime(c);
  if (durEl) durEl.textContent = fmtTime(d);
}

/** 播放态/模式/音量同步：只改按钮与唱片转动，不整页重渲染 */
function syncPlayerControls() {
  const btn = document.querySelector('.pp-controls [data-act="toggle"]');
  if (!btn || !btn.isConnected) return;
  const isPlaying = !player.audio.paused;
  btn.innerHTML = isPlaying ? PI.pause : PI.play;
  btn.title = isPlaying ? "暂停" : "播放";
  const vinylEl = document.getElementById("meiVinyl");
  if (vinylEl) vinylEl.classList.toggle("spin", isPlaying);
  const modeBtn = document.querySelector('.pp-controls [data-act="mode"]');
  if (modeBtn) {
    modeBtn.innerHTML = PI[player.mode];
    modeBtn.title = MODE_LABELS[player.mode] || "播放模式";
  }
  const v = document.getElementById("ppVol");
  if (v && document.activeElement !== v && Number.isFinite(player.audio.volume)) {
    v.value = String(Math.round(player.audio.volume * 100));
  }
}

/** 歌词绘制：两种形态共用，容器不存在时静默跳过（页面已切走） */
function drawLyricAll() {
  const boxes = [document.getElementById("meiLyric"), document.getElementById("meiLyricSide")].filter(Boolean);
  if (boxes.length === 0) return;
  let html;
  if (player.lyric.length === 0) {
    html = `<div class="l-line">纯音乐，请欣赏</div>`;
  } else {
    const idx = player.lyricIdx;
    const from = Math.max(0, idx - 1);
    const slice = player.lyric.slice(from, from + 5);
    html = slice.map((l, k) => `<div class="l-line ${from + k === idx ? "on" : ""}">${escapeHtml(l.text)}</div>`).join("");
  }
  boxes.forEach((b) => { b.innerHTML = html; });
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
      pushRoute("/player");
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
        <button class="mei-btn" id="goSearch">${I.search} 去搜索</button>
      </div>
    `;
    root.querySelector("#goSearch").onclick = () => pushRoute("/search");
    return;
  }
  // 收藏页是浏览页：展示收藏列表，点击歌曲才播放，不自动跳转播放页
  if (player.queueType !== "fav") {
    // 仅设置队列但不开播播放，保持当前播放状态
    player.setQueue("fav", 0);
  }
  root.classList.add("wide");
  root.innerHTML = `
    <div class="mei-fav-page">
      <div class="mei-fav-head">
        <h2 class="mei-fav-title">${I.heart} 我的收藏</h2>
        <span class="mei-fav-count">${store.favorites.length} 首</span>
        <div class="mei-fav-actions">
          <button class="mei-btn-ghost" id="favPlayAll">${I.play} 播放全部</button>
          <button class="mei-btn-ghost" id="favShuffle">${I.shuffle} 随机播放</button>
        </div>
      </div>
      <div class="mei-fav-list" id="favList">
        ${store.favorites.map((song, i) => songRowHtml(song, i, {
          playing: player.queueType === "fav" && i === player.index,
          showSort: false,
          showFav: true,
        })).join("")}
      </div>
    </div>
  `;

  // 播放全部：设置队列为收藏，从第一首开始播放，然后跳播放页
  root.querySelector("#favPlayAll").onclick = () => {
    player.setQueue("fav", 0);
    player.playIndex(0);
    loadLyric();
    pushRoute("/player");
  };

  // 随机播放
  root.querySelector("#favShuffle").onclick = () => {
    player.setQueue("fav", Math.floor(Math.random() * store.favorites.length));
    player.playIndex(player.index);
    loadLyric();
    pushRoute("/player");
  };

  // 逐首歌曲操作
  root.querySelectorAll(".mei-song-row").forEach((row) => {
    const i = parseInt(row.dataset.idx, 10);
    row.querySelector('[data-act="play"]').onclick = () => {
      if (player.queueType !== "fav") player.setQueue("fav", i);
      player.playIndex(i);
      loadLyric();
      pushRoute("/player");
    };
    const unfav = row.querySelector('[data-act="unfav"]');
    if (unfav) unfav.onclick = () => {
      store.removeFavorite(songKey(store.favorites[i]));
      renderFavorites(root);
    };
    const del = row.querySelector('[data-act="del"]');
    if (del) del.onclick = () => {
      store.removeFavorite(songKey(store.favorites[i]));
      renderFavorites(root);
    };
  });
}

// ============ 已下载管理（/downloads，server 模式下载的磁盘曲库）============
// 数据：GET /api/download/library → tasks（进行中/近期任务，置顶轮询）+ files（磁盘扫描）
// 播放：serverLocalSong(file) 构造 source=server-local 条目交给现有 store/player 体系，
//       resolvePlayUrl 的 server-local 分支直出 /api/download/serve 流地址
let dlState = { loading: true, error: "", tasks: [], files: [] };
let dlViewToken = 0; // 视图令牌：路由离开后使在途回调全部失效
let dlPollTimer = 0;

/** 停止轮询（main.js 在路由切走时调用） */
export function stopDownloadsPolling() {
  dlViewToken += 1;
  clearTimeout(dlPollTimer);
}

function fmtBytes(n) {
  const size = Number(n) || 0;
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function dlTaskHtml(task) {
  const running = task.status === "running";
  const badge = running
    ? (task.phase === "resolving" ? "解析中" : `${task.percent || 0}%`)
    : task.status === "done" ? "已完成" : "失败";
  const sub = running
    ? [
        task.phase === "resolving" ? "正在解析播放地址…" : `已下载 ${fmtBytes(task.received)}${task.total > 0 ? ` / ${fmtBytes(task.total)}` : ""}`,
        task.speed > 0 ? `${fmtBytes(task.speed)}/s` : "",
      ].filter(Boolean).join(" · ")
    : task.status === "done"
      ? `已保存：${task.path}`
      : (task.error || "下载失败");
  const percent = running && task.phase === "downloading" ? Math.max(2, task.percent || 0) : (task.status === "done" ? 100 : 0);
  return `
    <div class="mei-dl-task ${task.status === "error" ? "error" : ""}">
      <div class="t-head">
        <span class="t-badge">${badge}</span>
        <span class="t-name">${escapeHtml(task.song && task.song.name || "未知歌曲")}</span>
        <span class="t-sub">${escapeHtml(task.song && task.song.artist || "")} · ${escapeHtml(sourceLabel(task.song && task.song.source))}</span>
      </div>
      ${running || task.status === "done" ? `<div class="mei-dl-bar"><i style="width:${percent}%"></i></div>` : ""}
      <div class="t-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

function dlFileRowHtml(file, i) {
  const song = serverLocalSong(file);
  const faved = store.isFavorite(song);
  return `
    <div class="mei-song-row" data-idx="${i}">
      <span class="r-idx">${i + 1}</span>
      <span class="r-cover" style="display:flex;align-items:center;justify-content:center;color:var(--primary)" title="已下载到服务器">${I.disc}</span>
      <div class="r-meta">
        <div class="r-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <div class="r-sub" title="${escapeHtml(file.fileName)}">${escapeHtml(file.fileName)} · ${fmtBytes(file.size)}</div>
      </div>
      <span class="r-src">已下载</span>
      <div class="r-ops">
        <button class="mei-icon-btn" data-act="play" title="播放">${I.play}</button>
        <button class="mei-icon-btn" data-act="add" title="添加到播放列表">${I.plus}</button>
        <button class="mei-icon-btn ${faved ? "faved" : ""}" data-act="fav" title="${faved ? "取消收藏" : "收藏"}">${faved ? I.heartFill : I.heart}</button>
        <button class="mei-icon-btn danger" data-act="del" title="删除文件">${I.trash}</button>
      </div>
    </div>
  `;
}

export function renderDownloads(root) {
  const token = ++dlViewToken;
  clearTimeout(dlPollTimer);

  const load = async () => {
    if (token !== dlViewToken) return;
    try {
      const data = await fetchDownloadLibrary();
      if (token !== dlViewToken) return;
      dlState = { loading: false, error: "", tasks: data.tasks, files: data.files };
    } catch (e) {
      if (token !== dlViewToken) return;
      dlState = { loading: false, error: (e && e.message) || "加载失败", tasks: [], files: [] };
    }
    draw();
    schedulePoll();
  };

  // 有进行中任务时轮询刷新（1.5s），无任务即停
  const schedulePoll = () => {
    clearTimeout(dlPollTimer);
    if (token !== dlViewToken) return;
    if (dlState.tasks.some((t) => t.status === "running")) {
      dlPollTimer = setTimeout(load, 1500);
    }
  };

  const draw = () => {
    if (token !== dlViewToken) return;
    if (dlState.loading) {
      root.innerHTML = `<div class="mei-loading"><span class="mei-spin"></span>正在加载已下载列表…</div>`;
      return;
    }
    if (dlState.error) {
      root.innerHTML = `
        <div class="mei-empty" style="padding-top:14vh">
          <div class="e-icon">${I.folder}</div>
          <div>${escapeHtml(dlState.error)}</div>
          <button class="mei-btn" id="dlRetry">重试</button>
        </div>
      `;
      root.querySelector("#dlRetry").onclick = () => { dlState.loading = true; draw(); load(); };
      return;
    }

    const totalSize = dlState.files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
    const runningTasks = dlState.tasks.filter((t) => t.status === "running");
    const recentTasks = dlState.tasks.filter((t) => t.status !== "running" && t.finishedAt && Date.now() - t.finishedAt < 10 * 60 * 1000);

    // 按歌手分组（服务端已保证两层结构：目录名=歌手）
    const groups = new Map();
    for (const f of dlState.files) {
      if (!groups.has(f.artist)) groups.set(f.artist, []);
      groups.get(f.artist).push(f);
    }
    const globalIdx = (file) => dlState.files.indexOf(file);

    root.innerHTML = `
      <div class="mei-pagehead">
        <div>
          <h2>已下载</h2>
          <div class="sub">本地服务器下载的歌曲 · ${dlState.files.length} 首${totalSize > 0 ? ` · ${fmtBytes(totalSize)}` : ""}</div>
        </div>
        <div class="ops">
          <button class="mei-btn-ghost mei-btn-sm" id="dlRefresh" title="刷新列表">${I.up} 刷新</button>
        </div>
      </div>
      ${runningTasks.length + recentTasks.length > 0 ? `
        <div class="mei-dl-tasks">
          ${runningTasks.map(dlTaskHtml).join("")}
          ${recentTasks.map(dlTaskHtml).join("")}
        </div>
      ` : ""}
      ${dlState.files.length === 0 ? `
        <div class="mei-empty" style="padding-top:10vh">
          <div class="e-icon">${I.folder}</div>
          <div>还没有已下载的歌曲</div>
          <div style="margin:6px 0 18px;font-size:12px;color:var(--faint)">下载方式设为本地服务器后，下载的歌曲会保存在这里</div>
          <button class="mei-btn" id="dlGoSearch">${I.search} 去搜索下载</button>
        </div>
      ` : ""}
      ${[...groups.entries()].map(([artist, files]) => `
        <div class="mei-dl-group">
          <div class="mei-dl-group-head">${I.folder} ${escapeHtml(artist)} <span class="cnt">${files.length} 首</span></div>
          <div class="mei-fav-list mei-dl-list">
            ${files.map((f) => dlFileRowHtml(f, globalIdx(f))).join("")}
          </div>
        </div>
      `).join("")}
    `;

    root.querySelector("#dlRefresh").onclick = () => { dlState.loading = true; draw(); load(); };
    const goSearch = root.querySelector("#dlGoSearch");
    if (goSearch) goSearch.onclick = () => pushRoute("/search");

    // 已下载文件操作：播放 / 加列表 / 收藏 / 删除（二次确认）
    root.querySelectorAll(".mei-dl-list .mei-song-row").forEach((row) => {
      const file = dlState.files[parseInt(row.dataset.idx, 10)];
      if (!file) return;
      const song = serverLocalSong(file);
      row.querySelector('[data-act="play"]').onclick = () => playSingle(song);
      row.querySelector('[data-act="add"]').onclick = (e) => openAddToListMenu(e.currentTarget, song);
      row.querySelector('[data-act="fav"]').onclick = (e) => {
        const faved = store.toggleFavorite(song);
        e.currentTarget.classList.toggle("faved", faved);
        e.currentTarget.innerHTML = faved ? I.heartFill : I.heart;
        e.currentTarget.title = faved ? "取消收藏" : "收藏";
        toast(faved ? "已加入收藏" : "已取消收藏");
      };
      row.querySelector('[data-act="del"]').onclick = async () => {
        const ok = await confirmDialog(
          `删除已下载文件「${file.name} - ${file.artist}」？文件将从服务器磁盘移除，收藏与播放列表中的条目不受影响。`,
          { danger: true, okText: "删除" }
        );
        if (!ok) return;
        try {
          await deleteDownloadFile(file.path);
          toast("文件已删除");
          load();
        } catch (e) {
          toast((e && e.message) || "删除失败，请稍后重试");
        }
      };
    });
  };

  dlState.loading = true;
  draw();
  load();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
