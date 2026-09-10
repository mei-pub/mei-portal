/**
 * QQ 音乐源 —— 移植自 coco-downloader providers/qq.py
 * 接口：api.vkeys.cn（腾讯音乐搜索 + 播放地址）
 */

const SEARCH_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: 'https://y.qq.com',
  referer: 'https://y.qq.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

const TIMEOUT = 15000;
// 与 coco 一致的音质尝试顺序（0-10，首个返回有效地址的胜出）
const QUALITY_PRIORITY = Array.from({ length: 11 }, (_, i) => i);

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

async function url(id) {
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
