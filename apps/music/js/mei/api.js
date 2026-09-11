// Mei Music API 层：聚合搜索 / 播放地址 / 歌词 / 封面 / 远端存储 / 下载
// 说明：路径常量使用双引号字面量，nginx sub_filter 会将其改写为 /music 前缀子路径

import { toast, progressToast, choiceDialog } from "./ui.js";

const PROXY = "/proxy";
const STORAGE = "/api/storage";
// 服务端下载任务接口（双引号字面量，由 nginx sub_filter 改写为 /music 前缀）
const SERVER_DOWNLOAD_API = "/api/download/server";
const SERVER_DOWNLOAD_STATUS_API = "/api/download/server/status";

export const ALL_SOURCES = [
  { value: "netease", label: "网易云音乐" },
  { value: "qq", label: "QQ音乐" },
  { value: "kugou", label: "酷狗音乐" },
  { value: "kuwo", label: "酷我音乐" },
  { value: "migu", label: "咪咕音乐" },
  { value: "joox", label: "JOOX音乐" },
  { value: "bilibili", label: "哔哩哔哩" },
  { value: "youtube", label: "YouTube（实验性）" },
];

// qq/kugou/migu/kuwo 由服务端本地源直连实现（见 server/providers）
const DEFAULT_ENABLED = ["netease", "qq", "kugou", "kuwo", "migu", "joox", "youtube"];
const YOUTUBE_MIGRATION_KEY = "mei-youtube-source-migrated-v1";

// 启用源：与设置页（settings.html）共用 localStorage mei-music-sources
export function enabledSources() {
  try {
    const raw = localStorage.getItem("mei-music-sources");
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        if (!localStorage.getItem(YOUTUBE_MIGRATION_KEY)) {
          if (!list.includes("youtube")) list.push("youtube");
          localStorage.setItem("mei-music-sources", JSON.stringify(list));
          localStorage.setItem(YOUTUBE_MIGRATION_KEY, "1");
        }
        const enabled = ALL_SOURCES.filter((o) => list.includes(o.value));
        if (enabled.length > 0) return enabled;
      }
    }
  } catch (e) { /* ignore */ }
  localStorage.setItem(YOUTUBE_MIGRATION_KEY, "1");
  return ALL_SOURCES.filter((o) => DEFAULT_ENABLED.includes(o.value));
}

export function sourceLabel(value) {
  const found = ALL_SOURCES.find((o) => o.value === value);
  return found ? found.label : value || "未知源";
}

export function createSearchRequestGuard() {
  let latest = 0;
  return {
    begin() { return ++latest; },
    isCurrent(token) { return token === latest; },
  };
}

// 音频流代理包装：http 直链（混合内容风险）与 QQ vkey 直链（绑定解析方 IP）
// 必须经服务端转发播放，否则浏览器直连会 403/被拦
export function wrapStreamUrl(url, headers = null) {
  if (!url) return url;
  let u;
  try { u = new URL(url); } catch { return url; }
  const isHttp = u.protocol === "http:";
  const isQq = /(^|\.)qq\.com$/i.test(u.hostname);
  const isYoutube = /(^|\.)googlevideo\.com$/i.test(u.hostname);
  if (!isHttp && !isQq && !isYoutube) return url;
  const params = new URLSearchParams({ target: url });
  if (headers && typeof headers === "object" && Object.keys(headers).length > 0) {
    params.set("headers", JSON.stringify(headers));
  }
  return `${PROXY}?${params.toString()}`;
}

const sig = () => Math.random().toString(36).slice(2, 12);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`请求失败（${res.status}）`);
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

function normalizeSong(song, fallbackSource) {
  return {
    id: song.id,
    name: song.name || "未知歌曲",
    artist: Array.isArray(song.artist) ? song.artist.join(" / ") : song.artist || "未知艺术家",
    album: song.album || "",
    pic_id: song.pic_id || song.pic || "",
    url_id: song.url_id,
    lyric_id: song.lyric_id || song.id,
    source: song.source || fallbackSource || "netease",
  };
}

// 单源搜索
export async function searchSource(keyword, source, count = 20, page = 1) {
  const url = `${PROXY}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${count}&pages=${page}&s=${sig()}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) throw new Error("搜索结果格式错误");
  return data.map((s) => normalizeSong(s, source));
}

// 聚合搜索：并行查询指定启用源，源级失败不影响其他源
export async function searchAggregate(keyword, count = 20, onSourceDone, options = {}) {
  const { source = "", page = 1 } = options;
  const enabled = enabledSources();
  const sources = source ? enabled.filter((item) => item.value === source) : enabled;
  const tasks = sources.map(async (src) => {
    try {
      const list = await searchSource(keyword, src.value, count, page);
      onSourceDone && onSourceDone(src.value, list.length, null);
      return list;
    } catch (err) {
      onSourceDone && onSourceDone(src.value, 0, err);
      return [];
    }
  });
  const settled = await Promise.all(tasks);
  return settled.flat();
}

// 随机关键词聚合采样（随便听听用）：多关键词 × 多源并行
export async function sampleRandomSongs(keywords, perSourceCount = 30) {
  const sources = enabledSources().slice(0, 4);
  const tasks = [];
  for (const kw of keywords) {
    for (const src of sources) {
      tasks.push(
        searchSource(kw, src.value, perSourceCount, 1).catch(() => [])
      );
    }
  }
  const settled = await Promise.all(tasks);
  return settled.flat();
}

// 探索雷达播放列表（兜底）
export async function radarPlaylist(playlistId = "3778678", limit = 200) {
  const params = new URLSearchParams({ types: "playlist", id: playlistId, limit: String(limit), offset: "0", s: sig() });
  const data = await fetchJson(`${PROXY}?${params.toString()}`);
  const tracks = data && data.playlist && Array.isArray(data.playlist.tracks) ? data.playlist.tracks : [];
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artist: Array.isArray(t.ar) ? t.ar.map((a) => a.name).join(" / ") : "",
    album: t.al && t.al.name ? t.al.name : "",
    pic_id: t.al ? t.al.pic_str || t.al.pic || t.al.picUrl || "" : "",
    lyric_id: t.id,
    source: "netease",
  }));
}

// 播放地址：返回可播放 URL（types=url 返回 JSON {url, br, size...}）
// 音质降级链：320 → 192 → 128（部分歌曲高码率无资源时自动降级）
export async function resolvePlayUrl(song, quality = "320") {
  if (song.source === "youtube") {
    const params = new URLSearchParams({
      types: "download",
      source: "youtube",
      id: song.id,
      br: quality,
      filename: `${song.name || "music"} - ${song.artist || "youtube"}`,
    });
    return `${PROXY}?${params.toString()}`;
  }

  const chain = [quality, "192", "128"].filter((v, i, a) => a.indexOf(v) === i);
  for (const br of chain) {
    const url = `${PROXY}?types=url&id=${encodeURIComponent(song.id)}&source=${song.source || "netease"}&br=${br}&s=${sig()}`;
    try {
      const data = await fetchJson(url);
      if (data && typeof data === "object" && data.url) return wrapStreamUrl(data.url, data.headers);
    } catch (e) {
      // 本地源 400 = 该曲无任何可用地址（与码率无关），换码率只会重复失败，
      // 立刻中断降级链交给跨源兜底
      if (e && e.status === 400) break;
      /* 尝试下一档码率 */
    }
  }
  throw new Error("未获取到播放地址");
}

// 跨源兜底播放：本源解析失败时，按「歌名+歌手」在其他启用源中搜索同名歌曲，
// 依次尝试前若干个候选，返回第一个可播放地址（解决单源无版权/接口失效问题）
export async function resolvePlayUrlWithFallback(song, quality = "320") {
  try {
    return { url: await resolvePlayUrl(song, quality), song };
  } catch (firstError) {
    const key = `${song.source || "netease"}:${song.id}`;
    const candidates = await searchAggregate(`${song.name} ${song.artist}`, 3).catch(() => []);
    const others = candidates
      .filter((s) => `${s.source}:${s.id}` !== key)
      .slice(0, 6);
    for (const candidate of others) {
      try {
        return { url: await resolvePlayUrl(candidate, quality), song: candidate };
      } catch { /* 尝试下一个候选 */ }
    }
    throw firstError;
  }
}

export function picUrl(song, size = 300) {
  if (!song || !song.pic_id) return "";
  return `${PROXY}?types=pic&id=${encodeURIComponent(song.pic_id)}&source=${song.source || "netease"}&size=${size}&s=${sig()}`;
}

export async function fetchLyric(song) {
  const url = `${PROXY}?types=lyric&id=${song.lyric_id || song.id}&source=${song.source || "netease"}&s=${sig()}`;
  const data = await fetchJson(url);
  return data && typeof data === "object" ? data.lrc || "" : "";
}

// ── 下载（四模式）────────────────────────────────────────────────────────────
// 设置项「下载方式」：local 本地电脑 / server 本地服务器 / both 两者 / ask 每次询问。
// 存 localStorage（与设置页 settings.html 共用），默认 local：保持既有下载行为，
// 服务器下载需在设置页主动开启，避免老用户下载去向悄然改变。
const DOWNLOAD_MODE_KEY = "mei-download-mode";
export const DOWNLOAD_MODES = ["local", "server", "both", "ask"];

export function getDownloadMode() {
  try {
    const v = localStorage.getItem(DOWNLOAD_MODE_KEY);
    if (DOWNLOAD_MODES.includes(v)) return v;
  } catch { /* ignore */ }
  return "local";
}

export function setDownloadMode(mode) {
  if (!DOWNLOAD_MODES.includes(mode)) return false;
  try {
    localStorage.setItem(DOWNLOAD_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

// 本地电脑下载：解析真实地址后触发浏览器下载（同源代理流，浏览器自行落盘）
async function downloadToComputer(song, quality = "320") {
  if (song.source === "youtube") {
    const params = new URLSearchParams({
      types: "download",
      source: "youtube",
      id: song.id,
      br: quality,
      filename: `${song.name} - ${song.artist}`,
    });
    const a = document.createElement("a");
    a.href = `${PROXY}?${params.toString()}`;
    a.download = `${song.name} - ${song.artist}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const { url } = await resolvePlayUrlWithFallback(song, quality);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${song.name} - ${song.artist}`;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 本地服务器下载：创建任务 → toast 进度轮询 → 完成/失败 toast（内部自捕获，不外抛）
async function downloadToServer(song, quality = "320") {
  let task;
  try {
    const res = await fetch(SERVER_DOWNLOAD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: song.source || "netease",
        id: String(song.id),
        name: song.name || "",
        artist: song.artist || "",
        quality,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    task = await res.json();
  } catch (e) {
    toast(`服务器下载任务创建失败：${(e && e.message) || e}`);
    return;
  }
  if (task.status === "done") {
    toast(task.existed ? `服务器已有该文件：${task.path}` : `已保存到服务器：${task.path}`);
    return;
  }
  await trackServerDownload(task.id, song);
}

// 轮询服务器下载进度：常驻进度 toast 更新，完成/失败后转普通 toast
async function trackServerDownload(id, song) {
  const progress = progressToast(`正在下载到服务器：${song.name}`);
  const deadline = Date.now() + 15 * 60 * 1000; // 15 分钟兜底，防任务永久挂起
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${SERVER_DOWNLOAD_STATUS_API}?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`进度查询失败（HTTP ${res.status}）`);
      const t = await res.json();
      if (t.status === "done") {
        progress.close();
        toast(t.existed ? `服务器已有该文件：${t.path}` : `已保存到服务器：${t.path}`);
        return;
      }
      if (t.status === "error") {
        progress.close();
        toast(`服务器下载失败：${t.error || "未知错误"}`);
        return;
      }
      progress.update(t.total > 0
        ? `正在下载到服务器：${song.name} ${t.percent || 0}%`
        : `正在下载到服务器：${song.name} ${Math.round((t.received || 0) / 1024)}KB`);
    }
    throw new Error("下载超时未完成");
  } catch (e) {
    progress.close();
    toast(`服务器下载失败：${(e && e.message) || e}`);
  }
}

// 每次询问：轻量选择弹层（Esc / 遮罩关闭 = 取消下载，不阻塞其他操作）
async function chooseDownloadTarget(song) {
  return choiceDialog({
    title: "下载方式",
    sub: `「${song.name}」保存到哪里？`,
    options: [
      { value: "local", label: "本地电脑", primary: true },
      { value: "server", label: "本地服务器" },
    ],
  });
}

async function dispatchDownload(target, song, quality) {
  if (target === "both") {
    // 两者都要：本地与服务器并行执行，各自独立汇报结果
    downloadToComputer(song, quality).catch(() => toast("本地电脑下载失败，请稍后重试"));
    return downloadToServer(song, quality);
  }
  if (target === "server") return downloadToServer(song, quality);
  return downloadToComputer(song, quality);
}

// 下载统一入口：按「下载方式」设置分发到本地电脑 / 本地服务器 / 两者 / 询问
export async function downloadSong(song, quality = "320") {
  const mode = getDownloadMode();
  if (mode === "ask") {
    const choice = await chooseDownloadTarget(song);
    if (!choice) return; // Esc / 遮罩关闭：视为取消，不执行任何下载
    return dispatchDownload(choice, song, quality);
  }
  return dispatchDownload(mode, song, quality);
}

// 远端 KV 存储（可用性探测 + 读写；不可用时静默回退 localStorage）
export const remoteStorage = (() => {
  let availabilityPromise = null;
  let writeChain = Promise.resolve();
  const check = () => {
    if (!availabilityPromise) {
      availabilityPromise = (async () => {
        try {
          const res = await fetch(STORAGE + "?status=1");
          if (!res.ok) return false;
          const data = await res.json().catch(() => ({}));
          return Boolean(data && data.d1Available);
        } catch {
          return false;
        }
      })();
    }
    return availabilityPromise;
  };
  return {
    async getItems(keys) {
      if (!(await check())) return null;
      try {
        const res = await fetch(`${STORAGE}?keys=${encodeURIComponent(keys.join(","))}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.data ? data.data : null;
      } catch {
        return null;
      }
    },
    setItems(items) {
      // 收藏/播放列表连续修改时必须按用户操作顺序写入。
      // 否则慢请求里的旧数据会后返回并覆盖新数据，表现为偶发“收藏被清空”。
      const write = writeChain.then(async () => {
        if (!(await check())) return false;
        try {
          await fetch(STORAGE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: items }),
          });
          return true;
        } catch {
          return false;
        }
      });
      writeChain = write.catch(() => false);
      return write;
    },
  };
})();
