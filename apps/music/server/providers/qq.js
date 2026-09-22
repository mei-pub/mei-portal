/**
 * QQ 音乐源 —— 移植自 coco-downloader providers/qq.py
 * 搜索：api.vkeys.cn（腾讯音乐搜索）
 * 播放地址：90svip 全量音质（M800/C200 完整文件）→ vkeys 试听降级链
 */

const SEARCH_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: 'https://y.qq.com',
  referer: 'https://y.qq.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const SVIP90_BASE = 'https://music.90svip.cn/';

const TIMEOUT = 15000;
// 与 coco 一致的音质尝试顺序（0-10，首个返回有效地址的胜出）。
// vkeys 实测只能给 26-31kbps 试听地址（quality 参数不影响），仅作兜底。
const QUALITY_PRIORITY = Array.from({ length: 11 }, (_, i) => i);

const { probeAudioUrl } = require('./verify');

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

async function search(name, count = 20, page = 1) {
  const url = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(name)}`;
  const data = await fetchJson(url, { headers: SEARCH_HEADERS });
  const items = data && Array.isArray(data.data) ? data.data : [];
  return items
    .filter((it) => it && it.mid)
    .slice(0, count)
    .map((it) => ({
      id: String(it.mid),
      name: it.song || '未知歌曲',
      artist: [it.singer || '未知歌手'],
      album: it.album || '',
      pic_id: it.cover || '',
      url_id: String(it.mid),
      lyric_id: String(it.mid),
      source: 'qq',
    }));
}

/**
 * 90svip：POST 拿签名中转地址 → 跟随 302 拿最终直链（M800/C200 完整音质文件）。
 * 签名地址本身是 HTML 中转页，必须跟随重定向并校验后才能交给播放器。
 */
async function urlBy90svip(id) {
  const res = await fetch(SVIP90_BASE, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: SVIP90_BASE,
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ input: id, filter: 'id', type: 'qq', page: '1' }).toString(),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`90svip HTTP ${res.status}`);
  const data = await res.json();
  const item = data && Array.isArray(data.data) && data.data[0] ? data.data[0] : null;
  if (!item || !item.url) throw new Error('90svip 无播放地址');
  const signed = new URL(item.url, SVIP90_BASE).toString();
  const probe = await probeAudioUrl(signed, { referer: SVIP90_BASE, userAgent: UA });
  if (!probe) throw new Error('90svip 地址校验失败');
  // 跟随 302 后的最终直链（M800/C200 完整文件）；签名中转页直接交给播放器只会拿到 HTML
  return { url: probe.url, br: '128', size: probe.total };
}

async function url(id) {
  // 主链：90svip 全量音质（实测 M800 128kbps 完整文件，vkeys 只有 28kbps 试听）
  try {
    return await urlBy90svip(id);
  } catch {
    // 落到 vkeys 试听链
  }
  for (const quality of QUALITY_PRIORITY) {
    try {
      const data = await fetchJson(
        `https://api.vkeys.cn/v2/music/tencent/geturl?mid=${encodeURIComponent(id)}&quality=${quality}`,
        { headers: SEARCH_HEADERS }
      );
      if (!data || data.code !== 200 || !data.data) continue;
      const playUrl = data.data.url;
      if (typeof playUrl === 'string' && /^https?:\/\//.test(playUrl)) {
        return { url: playUrl, br: data.data.kbps || quality, size: 0 };
      }
    } catch {
      // 尝试下一档音质
    }
  }
  throw new Error('QQ 播放地址获取失败');
}

module.exports = { search, url };
