// Mei Music API 层：聚合搜索 / 播放地址 / 歌词 / 封面 / 远端存储
// 说明：路径常量使用双引号字面量，nginx sub_filter 会将其改写为 /music 前缀子路径

const PROXY = "/proxy";
const STORAGE = "/api/storage";

export const ALL_SOURCES = [
  { value: "netease", label: "网易云音乐" },
  { value: "qq", label: "QQ音乐" },
  { value: "kugou", label: "酷狗音乐" },
  { value: "kuwo", label: "酷我音乐" },
  { value: "migu", label: "咪咕音乐" },
  { value: "joox", label: "JOOX音乐" },
  { value: "bilibili", label: "哔哩哔哩" },
];

// qq/kugou/migu/kuwo 由服务端本地源直连实现（见 server/providers）
const DEFAULT_ENABLED = ["netease", "qq", "kugou", "kuwo", "migu", "joox"];

// 启用源：与设置页（settings.html）共用 localStorage mei-music-sources
export function enabledSources() {
  try {
    const raw = localStorage.getItem("mei-music-sources");
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const enabled = ALL_SOURCES.filter((o) => list.includes(o.value));
        if (enabled.length > 0) return enabled;
      }
    }
  } catch (e) { /* ignore */ }
  return ALL_SOURCES.filter((o) => DEFAULT_ENABLED.includes(o.value));
}

export function sourceLabel(value) {
  const found = ALL_SOURCES.find((o) => o.value === value);
  return found ? found.label : value || "未知源";
}

const sig = () => Math.random().toString(36).slice(2, 12);

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`请求失败（${res.status}）`);
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

// 聚合搜索：并行查询所有启用源，源级失败不影响其他源
export async function searchAggregate(keyword, count = 20, onSourceDone) {
  const sources = enabledSources();
  const tasks = sources.map(async (src) => {
    try {
      const list = await searchSource(keyword, src.value, count, 1);
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
  const chain = [quality, "192", "128"].filter((v, i, a) => a.indexOf(v) === i);
  for (const br of chain) {
    const url = `${PROXY}?types=url&id=${encodeURIComponent(song.id)}&source=${song.source || "netease"}&br=${br}&s=${sig()}`;
    try {
      const data = await fetchJson(url);
      if (data && typeof data === "object" && data.url) return data.url;
    } catch { /* 尝试下一档码率 */ }
  }
  throw new Error("未获取到播放地址");
}

// 跨源兜底播放：本源解析失败时，按「歌名+歌手」在其他启用源中搜索同名歌曲，
// 依次尝试前若干个候选，返回第一个可播放地址（解决单源无版权/接口失效问题）
export async function resolvePlayUrlWithFallback(song, quality = "320") {
  try {
    return await resolvePlayUrl(song, quality);
  } catch (firstError) {
    const key = `${song.source || "netease"}:${song.id}`;
    const candidates = await searchAggregate(`${song.name} ${song.artist}`, 3).catch(() => []);
    const others = candidates
      .filter((s) => `${s.source}:${s.id}` !== key)
      .slice(0, 6);
    for (const candidate of others) {
      try {
        return await resolvePlayUrl(candidate, quality);
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

// 下载：先解析真实地址再触发浏览器下载
export async function downloadSong(song, quality = "320") {
  const url = await resolvePlayUrlWithFallback(song, quality);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${song.name} - ${song.artist}`;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 远端 KV 存储（可用性探测 + 读写；不可用时静默回退 localStorage）
export const remoteStorage = (() => {
  let availabilityPromise = null;
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
    async setItems(items) {
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
    },
  };
})();
