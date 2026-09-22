/**
 * 咪咕音乐源 —— 移植自 coco-downloader providers/migu.py
 * 接口：咪咕官方 c.musicapp.migu.cn（搜索 + listen-url 播放地址）
 */

const TIMEOUT = 15000;

// 与 coco 一致的完整请求头（咪咕接口校验较多，缺头会 201007）
const SEARCH_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  activityid: 'v4_zt_2022_music',
  appid: 'ce',
  channel: '014X031',
  deviceid: 'E60C6B2F-7F11-4362-9FCE-6F1CC86E0F18',
  logid: 'h5page[1808]',
  'mgm-network-operators': '02',
  'mgm-network-standard': '03',
  'mgm-network-type': '03',
  origin: 'https://y.migu.cn',
  recommendstatus: '1',
  referer: 'https://y.migu.cn/app/v4/zt/2022/music/index.html',
  subchannel: '014X031',
  test: '00',
  ua: 'Android_migu',
  version: '6.8.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  return fetch(url, { ...options, headers: SEARCH_HEADERS, signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

function buildSearchUrl(keyword, pageNo = 1, pageSize = 20) {
  const qs = new URLSearchParams({
    text: keyword,
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    isCopyright: '1',
    sort: '1',
    searchSwitch: "{'song': 1, 'album': 0, 'singer': 0, 'tagSong': 1, 'mvSong': 0, 'bestShow': 1}",
  });
  return `https://c.musicapp.migu.cn/v1.0/content/search_all.do?${qs}`;
}

function joinNames(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => (it && it.name ? String(it.name) : ''))
    .filter(Boolean)
    .join(', ');
}

function parseSize(value) {
  const n = parseFloat(String(value || '').replace('MB', '').trim());
  return Number.isFinite(n) ? n : 0;
}

function extractSongs(data) {
  const sd = data && data.songResultData;
  return sd && Array.isArray(sd.result) ? sd.result : [];
}

async function search(name, count = 20, page = 1) {
  const data = await fetchJson(buildSearchUrl(String(name || ''), page, Math.min(count, 20)));
  return extractSongs(data)
    .filter((it) => it && it.contentId && it.copyrightId)
    .map((it) => {
      const id = `${it.contentId}_${it.copyrightId}`;
      const imgs = Array.isArray(it.imgItems) ? it.imgItems : [];
      const cover = imgs.length > 0 && imgs[imgs.length - 1] ? imgs[imgs.length - 1].img || '' : '';
      return {
        id,
        name: it.name || '未知歌曲',
        artist: [joinNames(it.singers) || '未知歌手'],
        album: joinNames(it.albums),
        pic_id: cover,
        url_id: id,
        lyric_id: id,
        source: 'migu',
      };
    });
}

/** 按 contentId 反查歌曲，取可用码率列表（按体积降序） */
async function findRateFormats(contentId) {
  const data = await fetchJson(buildSearchUrl(contentId, 1, 1));
  const items = extractSongs(data);
  const song = items.find((it) => it && it.contentId === contentId) || items[0];
  if (!song) return [];
  const rates = [...(song.rateFormats || []), ...(song.newRateFormats || [])];
  return rates
    .filter((r) => r && r.formatType && r.resourceType)
    .sort(
      (a, b) =>
        parseSize(b.size || b.iosSize || b.androidSize) -
        parseSize(a.size || a.iosSize || a.androidSize)
    );
}

async function url(id) {
  const [contentId, copyrightId] = String(id).split('_');
  if (!contentId || !copyrightId) throw new Error('无效的咪咕歌曲 ID');
  const rates = await findRateFormats(contentId);
  for (const rate of rates) {
    const resourceType = String(rate.resourceType);
    const toneFlag = String(rate.formatType);
    try {
      const data = await fetchJson(
        `https://c.musicapp.migu.cn/MIGUM3.0/strategy/listen-url/v2.4?resourceType=${resourceType}&netType=01&scene=&toneFlag=${toneFlag}&contentId=${contentId}&copyrightId=${copyrightId}&lowerQualityContentId=${contentId}`
      );
      let playUrl = data && data.data && data.data.url;
      if (!playUrl) {
        // 兜底：listenSong.do 拼装地址（与 coco 一致，128→320 路径替换）
        playUrl =
          `https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx` +
          `&copyrightId=${copyrightId}&contentId=${contentId}&toneFlag=${toneFlag}` +
          `&resourceType=${resourceType}&userId=15548614588710179085069&netType=00`;
      }
      playUrl = String(playUrl).replace('/MP3_128_16_Stero/', '/MP3_320_16_Stero/');
      // 校验地址确实返回音频（咪咕接口失效时会返回 JSON 错误而不是音频，
      // 必须在这里抛出，让前端跨源兜底接管，否则 <audio> 会静默失败）
      const head = await fetch(playUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0', ...SEARCH_HEADERS },
        signal: AbortSignal.timeout(TIMEOUT),
      }).catch(() => null);
      const contentType = head && head.headers ? head.headers.get('content-type') || '' : '';
      const looksAudio = /audio|mpeg|flac|octet-stream/i.test(contentType);
      if (!head || !head.ok || !looksAudio) continue;
      return { url: playUrl, br: toneFlag, size: 0 };
    } catch {
      // 下一档码率
    }
  }
  throw new Error('咪咕播放地址获取失败');
}

module.exports = { search, url };
