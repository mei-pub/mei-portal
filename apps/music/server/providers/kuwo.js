/**
 * 酷我音乐源（仅播放地址覆盖）—— 搜索/封面/歌词仍走 gdstudio 上游
 *
 * 背景：gdstudio 的 kuwo 搜索可用，但 types=url 长期返回空地址。
 * 这里按 antiserver 直链 → mobi 签名接口 → 90svip 三级降级解析真实 mp3 地址。
 *
 * 直链校验必须用 Range GET（bytes=0-1 读 Content-Range 总长）：
 * kuwo CDN 的 HEAD 响应缺失 Content-Length，按头部判断会把所有直链误判为提醒语音
 * （曾导致酷我源 100% 报「版权受限」）。
 */

const TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SVIP90_BASE = 'https://music.90svip.cn/';
// 版权受限时酷我返回约 180KB 的“请到手机端播放”提醒语音，按体积阈值识别
const MIN_AUDIO_BYTES = 400 * 1024;

const { probeAudioUrl } = require('./verify');

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
      if (isHttpUrl(text)) {
        const probe = await probeAudioUrl(text, {
          referer: 'https://www.kuwo.cn/',
          userAgent: UA,
          minBytes: MIN_AUDIO_BYTES,
        });
        if (probe) return { url: text, br: '320', size: probe.total };
      }
    }
  } catch {
    // 走兜底
  }
  // 兜底 1：mobi 签名接口
  try {
    const res = await fetch(
      `https://mobi.kuwo.cn/mobi.s?f=web&source=jiakong&type=convert_url_with_sign&rid=${encodeURIComponent(id)}&br=2000kflac`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) }
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const playUrl = data && data.data && data.data.url;
      if (isHttpUrl(playUrl)) {
        const probe = await probeAudioUrl(playUrl, {
          referer: 'https://www.kuwo.cn/',
          userAgent: UA,
          minBytes: MIN_AUDIO_BYTES,
        });
        if (probe) return { url: playUrl, br: data.data.bitrate || 'flac', size: probe.total };
      }
    }
  } catch {
    // 走兜底
  }
  // 兜底 2：90svip（type=kuwo，签名地址跟随 302 后为完整音质文件）
  try {
    const res = await fetch(SVIP90_BASE, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: SVIP90_BASE,
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ input: id, filter: 'id', type: 'kuwo', page: '1' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const item = data && Array.isArray(data.data) && data.data[0] ? data.data[0] : null;
      if (item && isHttpUrl(item.url)) {
        const signed = new URL(item.url, SVIP90_BASE).toString();
        const probe = await probeAudioUrl(signed, {
          referer: SVIP90_BASE,
          userAgent: UA,
          minBytes: MIN_AUDIO_BYTES,
        });
        if (probe) return { url: probe.url, br: '320', size: probe.total };
      }
    }
  } catch {
    // 全部失败
  }
  throw new Error('酷我该歌曲无可用播放地址（版权受限）');
}

module.exports = { url };
