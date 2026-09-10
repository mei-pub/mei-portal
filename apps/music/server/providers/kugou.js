/**
 * 酷狗音乐源 —— 移植自 coco-downloader providers/kugou.py
 * 搜索：酷狗官方 songsearch.kugou.com
 * 播放地址：90svip → 尘归归 → 海棠 降级链
 * 歌词：酷狗官方 lyrics.kugou.com
 */

const TIMEOUT = 15000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const SEARCH_HEADERS = { 'User-Agent': UA };
const SVIP90_BASE = 'https://music.90svip.cn/';
const CGG_API = 'https://music-api2.cenguigui.cn/';
const HAITANG_APIS = [
  'https://musicapi.haitangw.net/kgqq/kg.php',
  'https://music.haitangw.cc/kgqq/kg.php',
];

function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  return fetch(url, { ...options, signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//.test(v);
}

function normalizeCover(v) {
  return typeof v === 'string' && v ? v.replace('{size}', '400') : '';
}

async function search(name, count = 20, page = 1) {
  const pageSize = Math.min(Math.max(parseInt(count, 10) || 20, 1), 30);
  const qs = new URLSearchParams({
    format: 'json',
    keyword: String(name || '').trim(),
    platform: 'WebFilter',
    page: String(page),
    pagesize: String(pageSize),
  });
  const data = await fetchJson(`https://songsearch.kugou.com/song_search_v2?${qs}`, {
    headers: SEARCH_HEADERS,
  });
  const lists = data && data.data && Array.isArray(data.data.lists) ? data.data.lists : [];
  return lists
    .filter((it) => it && (it.FileHash || it.hash))
    .map((it) => {
      const trans = it.trans_param || {};
      return {
        id: String(it.FileHash || it.hash),
        name: it.SongName || it.songname || it.FileName || '未知歌曲',
        artist: [it.SingerName || it.singername || '未知歌手'],
        album: it.AlbumName || it.album_name || '',
        pic_id: normalizeCover(trans.union_cover || it.cover_url || it.Image),
        url_id: String(it.FileHash || it.hash),
        lyric_id: String(it.FileHash || it.hash),
        source: 'kugou',
      };
    });
}

/** 90svip：POST 拿签名地址 → 手动跟随 302 取最终直链 */
async function urlBy90svip(hash) {
  const res = await fetch(SVIP90_BASE, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: SVIP90_BASE,
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ input: hash, filter: 'id', type: 'kugou', page: '1' }).toString(),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`90svip HTTP ${res.status}`);
  const data = await res.json();
  const item = data && Array.isArray(data.data) && data.data[0] ? data.data[0] : null;
  if (!item || !item.url) throw new Error('90svip 无播放地址');
  const signed = new URL(item.url, SVIP90_BASE).toString();
  // 跟随重定向取真实 mp3 直链（取不到就用签名地址，浏览器可自行跟随 302）
  try {
    const probe = await fetch(signed, {
      method: 'GET',
      redirect: 'manual',
      headers: { Referer: SVIP90_BASE, 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const location = probe.headers.get('location');
    if (isHttpUrl(location)) return { url: location, br: '320', size: 0 };
  } catch {
    // 回退签名地址
  }
  return { url: signed, br: '320', size: 0 };
}

/** 尘归归备用 */
async function urlByCenguigui(hash) {
  for (const level of ['lossless', 'exhigh', 'standard']) {
    try {
      const qs = new URLSearchParams({ kg: '', id: hash, type: 'song', format: 'json', level });
      const data = await fetchJson(`${CGG_API}?${qs}`, { headers: SEARCH_HEADERS });
      const playUrl = data && data.data && data.data.url;
      if (isHttpUrl(playUrl)) return { url: playUrl, br: level, size: 0 };
    } catch {
      // 下一档
    }
  }
  throw new Error('尘归归无播放地址');
}

/** 海棠备用 */
async function urlByHaitang(hash) {
  for (const api of HAITANG_APIS) {
    for (const level of ['hires', 'lossless', 'exhigh']) {
      try {
        const qs = new URLSearchParams({ type: 'json', id: hash, level });
        const data = await fetchJson(`${api}?${qs}`, { headers: SEARCH_HEADERS });
        const playUrl = data && data.data && data.data.url;
        if (isHttpUrl(playUrl)) return { url: playUrl, br: level, size: 0 };
      } catch {
        // 下一档
      }
    }
  }
  throw new Error('海棠无播放地址');
}

async function url(id) {
  const chain = [urlBy90svip, urlByCenguigui, urlByHaitang];
  let lastError = null;
  for (const resolver of chain) {
    try {
      return await resolver(id);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('酷狗播放地址获取失败');
}

/** 歌词：官方 lyrics.kugou.com（搜索候选 → base64 解码） */
async function lyric(id) {
  try {
    const searchQs = new URLSearchParams({ keyword: '', duration: '-1', hash: id });
    const searchData = await fetchJson(`http://lyrics.kugou.com/search?${searchQs}`, {
      headers: SEARCH_HEADERS,
    });
    const candidate =
      searchData && Array.isArray(searchData.candidates) && searchData.candidates[0];
    if (!candidate || !candidate.id || !candidate.accesskey) return { lrc: '' };
    const downloadQs = new URLSearchParams({
      ver: '1',
      client: 'pc',
      id: String(candidate.id),
      accesskey: candidate.accesskey,
      fmt: 'lrc',
      charset: 'utf8',
    });
    const lyricData = await fetchJson(`http://lyrics.kugou.com/download?${downloadQs}`, {
      headers: SEARCH_HEADERS,
    });
    const encoded = lyricData && lyricData.content;
    if (!encoded) return { lrc: '' };
    return { lrc: Buffer.from(encoded, 'base64').toString('utf-8') };
  } catch {
    return { lrc: '' };
  }
}

module.exports = { search, url, lyric };
