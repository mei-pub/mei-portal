/**
 * 酷我音乐源（仅播放地址覆盖）—— 搜索/封面/歌词仍走 gdstudio 上游
 *
 * 背景：gdstudio 的 kuwo 搜索可用，但 types=url 长期返回空地址。
 * 这里用酷我 antiserver 直链接口解析真实 mp3 地址（实测可用），
 * 兜底 mobi.kuwo.cn 签名接口。
 */

const TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//.test(v);
}

async function url(id) {
  // 主链：antiserver 直链（纯文本返回 mp3 URL）
  try {
    const res = await fetch(
      `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${encodeURIComponent(id)}&format=mp3&response=url`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) }
    );
    if (res.ok) {
      const text = (await res.text()).trim();
      if (isHttpUrl(text)) return { url: text, br: '320', size: 0 };
    }
  } catch {
    // 走兜底
  }
  // 兜底：mobi 签名接口
  const res = await fetch(
    `https://mobi.kuwo.cn/mobi.s?f=web&source=jiakong&type=convert_url_with_sign&rid=${encodeURIComponent(id)}&br=2000kflac`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) }
  );
  if (res.ok) {
    const data = await res.json().catch(() => null);
    const playUrl = data && data.data && data.data.url;
    if (isHttpUrl(playUrl)) return { url: playUrl, br: data.data.bitrate || 'flac', size: 0 };
  }
  throw new Error('酷我播放地址获取失败');
}

module.exports = { url };
