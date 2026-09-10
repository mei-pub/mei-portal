/**
 * 直链可用性探测 —— 供 qq/kugou/kuwo 等本地源共用
 *
 * 为什么用 Range GET 而不是 HEAD：
 *   kuwo / migu 等 CDN 的 HEAD 响应经常缺失 Content-Length（chunked），
 *   按头部判断会把完全可用的直链误判为「提醒语音」而拒绝。
 *   Range GET（bytes=0-1）开销与 HEAD 相当，但能从 Content-Range 里拿到总长。
 *
 * 校验内容：
 *   1. 响应 2xx（200/206），其余（403/过期）视为不可用；
 *   2. Content-Type 是音频类（audio/*、video/*、octet-stream），
 *      text/html 是防盗链提示页或 90svip 签名中转页，必须拒绝；
 *   3. 总大小 ≥ minBytes（版权受限源常返回 ~180KB 的「请到手机端播放」提醒语音）。
 *   4. 跟随重定向后返回最终直链（res.url）：90svip 的签名地址是 302 中转页，
 *      直接交给浏览器 <audio> 会拿到 HTML 而不是音频。
 */

const DEFAULT_MIN_BYTES = 400 * 1024;
const DEFAULT_TIMEOUT = 10000;

/**
 * @param {string} target 待探测的直链（或 302 中转签名地址）
 * @param {{ minBytes?: number, referer?: string, userAgent?: string, timeout?: number }} [options]
 * @returns {Promise<{ url: string, total: number, type: string } | null>}
 *   探测失败（网络异常 / 非 2xx / 非音频 / 体积过小）返回 null
 */
async function probeAudioUrl(target, options = {}) {
  const minBytes = Number.isFinite(options.minBytes) ? options.minBytes : DEFAULT_MIN_BYTES;
  const headers = {
    'User-Agent':
      options.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    Range: 'bytes=0-1',
  };
  if (options.referer) headers.Referer = options.referer;

  let res;
  try {
    res = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeout || DEFAULT_TIMEOUT),
    });
  } catch {
    return null;
  }
  if (!res.ok && res.status !== 206) return null;
  const type = res.headers.get('content-type') || '';
  if (type && !/audio|video|octet-stream/i.test(type)) return null;

  let total = 0;
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const m = /\/(\d+)\s*$/.exec(contentRange);
    if (m) total = parseInt(m[1], 10);
  }
  if (!total) {
    // 服务端忽略 Range（200 全量）时 Content-Length 即总长
    total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
  }
  if (total && total < minBytes) return null;

  const finalUrl = res.url || target;
  if (!/^https?:\/\//i.test(finalUrl)) return null;
  return { url: finalUrl, total, type };
}

module.exports = { probeAudioUrl, DEFAULT_MIN_BYTES };
