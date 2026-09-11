// Mei Music 入口：状态初始化 / history 路由 / 左侧窄面板 / 底部播放条
import { store, on } from "./store.js";
import { player } from "./player.js";
import { hostBridge } from "./hostbridge.js";
import { renderSearch, renderPlaylists, renderPlayer, renderRandom, renderFavorites, loadLyric } from "./views.js";
import { I, toast } from "./ui.js";
import { migrateLegacyHashRoute, pushRoute, resolveRoute } from "./router.js";

const PANEL_KEY = "mei-float-solara";

const NAV_ITEMS = [
  { path: "/search", title: "搜索音乐播放", icon: I.search },
  { path: "/playlists", title: "播放列表", icon: I.list },
  { path: "/player", title: "正在播放", icon: I.play },
  { path: "/random", title: "随便听听", icon: I.shuffle },
  { path: "/favorites", title: "我的收藏", icon: I.heart },
];

function currentRoute() {
  return resolveRoute(location.pathname, location.search, location.hash);
}

function mountPanel() {
  let open = true;
  try { open = localStorage.getItem(PANEL_KEY) !== "1"; } catch { /* ignore */ }

  const render = () => {
    document.querySelectorAll(".mei-panel, .mei-panel-handle").forEach((el) => el.remove());
    const route = currentRoute().path;
    // 播放页：左侧面板选中态跟随当前播放队列（列表/收藏/随机）
    let activeRoute = route;
   if (route === "/player") {
     if (player.queueType === "fav") activeRoute = "/favorites";
     else if (player.queueType === "playlist") activeRoute = "/playlists";
    else if (player.mode === "shuffle") activeRoute = "/random";
      else activeRoute = "/player";
   }
   if (!open) {
      const handle = document.createElement("button");
      handle.className = "mei-panel-handle";
      handle.title = "展开面板";
      handle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      handle.onclick = () => { open = true; persist(); render(); };
      document.body.appendChild(handle);
      return;
    }
    const panel = document.createElement("nav");
    panel.className = "mei-panel";
    panel.innerHTML = `
      <button class="p-info" title="Mei Music 音乐播放">
        <span class="p-logo">♪</span>
        <span class="p-name">音乐播放</span>
      </button>
      <div class="p-divider"></div>
      ${NAV_ITEMS.map((item) => `
        <button class="p-item ${activeRoute === item.path ? "active" : ""}" data-path="${item.path}" title="${item.title}">${item.icon}</button>
      `).join("")}
      <div class="p-divider"></div>
      <button class="p-item" data-act="settings" title="播放设置">${I.gear}</button>
      <button class="p-collapse" title="收起面板">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
    `;
    panel.querySelector(".p-info").onclick = () => { pushRoute("/search"); };
    panel.querySelectorAll(".p-item").forEach((btn) => {
      if (btn.dataset.act === "settings") {
        // 播放设置页（settings.html）：新标签打开，不打断当前播放
        btn.onclick = () => {
          const url = "/music/settings.html";
          const win = window.open(url, "_blank", "noopener");
          if (!win) location.assign(url);
        };
        return;
      }
      btn.onclick = () => { pushRoute(btn.dataset.path); };
    });
    panel.querySelector(".p-collapse").onclick = () => { open = false; persist(); render(); };
    document.body.appendChild(panel);
  };
  const persist = () => {
    try { localStorage.setItem(PANEL_KEY, open ? "0" : "1"); } catch { /* ignore */ }
  };
  window.addEventListener("popstate", render);
  // 播放页切换队列（tab 切换列表）时联动刷新左侧面板选中态
  on("queue", render);
  // 与顶栏/播放条同构：支持宿主编程收起（不写记忆）
  window.addEventListener("mei-panel-set", (e) => {
    const detail = (e && e.detail) || {};
    open = !detail.collapsed;
    render();
  });
  render();
}

function route() {
  const { path, params } = currentRoute();
  const root = document.getElementById("view");
  if (!root) return;
 // 播放列表管理页与播放页加宽（左右布局需要更多横向空间）
  root.classList.toggle("wide", path === "/search" || path === "/playlists" || path === "/player" || path === "/favorites");
 switch (path) {
    case "/search":
      renderSearch(root, params);
      break;
    case "/playlists":
      renderPlaylists(root);
      break;
    case "/player":
      renderPlayer(root);
      break;
    case "/random":
      renderRandom(root);
      break;
    case "/favorites":
      renderFavorites(root);
      break;
    default:
      pushRoute("/search");
  }
}

function rerenderPreservingQueueScroll() {
  const oldList = document.querySelector("#view .q-list");
  const scrollTop = oldList ? oldList.scrollTop : 0;
  route();
  const newList = document.querySelector("#view .q-list");
  if (newList && scrollTop > 0) newList.scrollTop = scrollTop;
}

async function boot() {
  // 被门户外壳以 iframe 承载时进入宿主模式：播放由外壳常驻引擎负责
  const hosted = hostBridge.connect();
  if (hosted) {
    store.syncHook = () => hostBridge.pushData();
  }
  await store.init();
  player.init();

  const bar = document.getElementById("playerBar");
  player.mountBar(bar, { onOpenPlayer: () => { pushRoute("/player"); } });

  // 播放器核心事件：切歌时同步加载歌词（播放页歌词渲染）
  on("queue", () => {
    // 切歌/切队列：播放页整体重渲染（歌名、封面、队列 tab 选中态同步切换）
    if (currentRoute().path === "/player") {
      rerenderPreservingQueueScroll();
      loadLyric();
    }
  });

  // 播放失败：单首提示（自动跳下一首由 player 内部处理）；连续失败时提示检查音乐源
  on("playerror", (song) => toast(`「${song.name}」无法播放，已跳过`));
  on("playgiveup", () => toast("多首歌曲播放失败，请检查网络或更换音乐源"));

  // 数据变更时自动重渲染相关视图（列表管理 / 播放页队列）
  ["playlists", "favorites", "temp"].forEach((ev) =>
    on(ev, () => {
      const p = currentRoute().path;
      if (p === "/playlists" || p === "/player") rerenderPreservingQueueScroll();
    })
  );

  mountPanel();
  migrateLegacyHashRoute();
  window.addEventListener("popstate", route);
  route();
  if (hosted) {
    // 宿主已在 connect 时发过 hello；此处再补一次，覆盖外壳尚未 boot 完成的时序
    hostBridge.send({ type: "hello" });
  }
}

boot();
