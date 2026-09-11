/**
 * 代理接口 —— 移植自 functions/proxy.ts
 * GET /proxy
 *
 * 核心缓存逻辑与 Cloudflare 版完全一致：
 *   - Cache HIT  → 直接返回缓存内容，不请求上游
 *   - Cache MISS → 请求上游，成功后写入本地内存缓存（5 分钟 TTL）
 *   - 搜索结果为空 / 包含错误 → 不缓存
 */

const { Router } = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const cache = require('../cache');
const { getProvider } = require('../providers');

const API_BASE_URL = process.env.API_BASE_URL || 'https://music-api.gdstudio.xyz/api.php';
// 允许代理的音频 CDN 域名（各音乐源直链）
// 注意酷狗直链是 kugou.com（fs*.kugou.com，历史遗留只写了 kugou.cn，
// 导致 http 直链经代理时 100% 被 400 拒绝）；netease 旧源可能出现 http 的 126.net
const AUDIO_HOST_PATTERN =
  /(^|\.)(kuwo\.cn|kuwo\.com|kugou\.cn|kugou\.com|migu\.cn|qq\.com|126\.net|90svip\.cn|googlevideo\.com)$/i;

const SAFE_RESPONSE_HEADERS = [
  'content-type', 'cache-control', 'accept-ranges',
  'content-length', 'content-range', 'etag', 'last-modified', 'expires',
];

function isAllowedAudioHost(hostname) {
  return hostname && AUDIO_HOST_PATTERN.test(hostname);
}

const SAFE_UPSTREAM_HEADER_KEYS = new Set([
  'user-agent',
  'accept',
  'accept-language',
  'sec-fetch-mode',
  'origin',
  'referer',
]);

function parseProvidedHeaders(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => SAFE_UPSTREAM_HEADER_KEYS.has(key.toLowerCase()))
    );
  } catch {
    return {};
  }
}

function normalizeProvidedHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_UPSTREAM_HEADER_KEYS.has(key.toLowerCase()))
  );
}

function audioUpstreamHeaders(hostname, req, providedHeaders = {}) {
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
  };
  // 按源设置 Referer（部分 CDN 校验）
  if (/(^|\.)kuwo\.cn$/i.test(hostname)) headers['Referer'] = 'https://www.kuwo.cn/';
  else if (/(^|\.)qq\.com$/i.test(hostname)) headers['Referer'] = 'https://y.qq.com/';
  else if (/(^|\.)googlevideo\.com$/i.test(hostname)) {
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    headers['Origin'] = 'https://www.youtube.com';
    headers['Referer'] = 'https://www.youtube.com/';
  }
  if (/(^|\.)googlevideo\.com$/i.test(hostname)) {
    for (const [key, value] of Object.entries(providedHeaders)) {
      if (!SAFE_UPSTREAM_HEADER_KEYS.has(key.toLowerCase())) continue;
      headers[key] = value;
    }
  }
  return headers;
}

function buildCacheKey(url) {
  // 过滤随机防缓存签名 s 以及 nocache 参数，以便重试成功后能更新同一个缓存项
  const u = new URL(url);
  u.searchParams.delete('s');
  u.searchParams.delete('nocache');
  return u.toString();
}

/** 代理音乐源音频流（带 Range 支持；解决直链 IP 绑定/防盗链/混合内容） */
async function proxyAudioStream(targetUrl, req, res, options = {}) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).send('Invalid target');
  }

  if (!isAllowedAudioHost(parsed.hostname)) {
    return res.status(400).send('Invalid target');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).send('Invalid target');
  }
  const providedHeaders = {
    ...parseProvidedHeaders(req.query.headers),
    ...normalizeProvidedHeaders(options.headers),
  };
  const controller = new AbortController();
  const handleClose = () => controller.abort();
  res.once('close', handleClose);

  try {
    let current = parsed;
    let upstream;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const headers = audioUpstreamHeaders(current.hostname, req, providedHeaders);
      if (req.headers['range']) headers.Range = req.headers['range'];

      const connectController = new AbortController();
      const connectTimer = setTimeout(() => connectController.abort(), 30000);
      try {
        upstream = await fetch(current.toString(), {
          method: req.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.any([controller.signal, connectController.signal]),
        });
      } finally {
        clearTimeout(connectTimer);
      }
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get('location');
      if (!location) return res.status(502).send('Invalid upstream redirect');
      if (redirects === 5) return res.status(502).send('Too many redirects');
      current = new URL(location, current);
      if (!isAllowedAudioHost(current.hostname)) {
        return res.status(400).send('Invalid redirect target');
      }
    }
    res.status(upstream.status);

    for (const h of SAFE_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', upstream.ok ? 'public, max-age=3600' : 'no-store');
    if (options.filename) {
      const safeName = options.filename.replace(/[\r\n"]/g, '').slice(0, 180);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`
      );
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.log('[Proxy Audio] Request aborted');
      return;
    }
    console.error('[Proxy Audio]', err);
    if (!res.headersSent) return res.status(502).send('Upstream error');
    res.destroy(err);
  } finally {
    res.off('close', handleClose);
  }
}

/** 代理 music API 请求，带本地缓存 */
async function proxyApiRequest(reqUrl, req, res) {
  const cacheKey = buildCacheKey(reqUrl);
  const parsedReq = new URL(reqUrl);
  const bypassCache = parsedReq.searchParams.get('nocache') === 'true';

  // ── Cache HIT ──────────────────────────────────────────────────────────────
  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${reqUrl}`);
      res.setHeader('Content-Type', cached.contentType || 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Cache-Status', 'HIT');
      res.setHeader('Access-Control-Expose-Headers', 'X-Cache-Status');
      return res.send(cached.body);
    }
  }

  // ── Cache MISS：请求上游 ────────────────────────────────────────────────────
  console.log(`[Cache MISS] Fetching from upstream: ${reqUrl}`);

  let upstream;
  let responseText;
  let contentType;

  if (process.env.WRANGLER_API_URL) {
    // 转发给内部 Wrangler，利用其 BoringSSL 绕过 Cloudflare 验证
    const wranglerUrl = new URL(process.env.WRANGLER_API_URL + '/proxy');
    parsedReq.searchParams.forEach((value, key) => {
      if (key === 'target' || key === 'callback' || key === 's' || key === 'nocache') return;
      wranglerUrl.searchParams.set(key, value);
    });

    try {
      upstream = await fetch(wranglerUrl.toString(), {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'Accept': 'application/json',
        },
      });
      responseText = await upstream.text();
      contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    } catch (err) {
      console.error('[Proxy API via Wrangler fetch]', err);
      return res.status(502).send('Upstream proxy error');
    }
  } else {
    // 原逻辑，未配置 WRANGLER_API_URL 时直接 fetch API_BASE_URL
    const apiUrl = new URL(API_BASE_URL);
    parsedReq.searchParams.forEach((value, key) => {
      if (key === 'target' || key === 'callback' || key === 's' || key === 'nocache') return;
      apiUrl.searchParams.set(key, value);
    });

    if (!apiUrl.searchParams.has('types')) {
      return res.status(400).send('Missing types');
    }

    try {
      upstream = await fetch(apiUrl.toString(), {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'Accept': 'application/json',
        },
      });
      responseText = await upstream.text();
      contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    } catch (err) {
      console.error('[Proxy API fetch]', err);
      return res.status(502).send('Upstream error');
    }
  }

  // ── 判断是否缓存（与 Cloudflare 版本逻辑完全一致） ──────────────────────────
  const isSearch = parsedReq.searchParams.get('types') === 'search';
  const isEmptyResult = responseText.trim() === '[]';
  const isError = responseText.includes('"error"') || responseText.includes('"status":0');

  let shouldCache = upstream.status === 200 && !isError && !bypassCache;
  if (isSearch && isEmptyResult) shouldCache = false;

  if (shouldCache) {
    cache.set(cacheKey, { body: responseText, contentType }, 300); // 缓存 5 分钟
    console.log(`[Cache PUT] Saved to cache: ${reqUrl}`);
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Cache-Status', 'MISS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Cache-Status');
  res.setHeader('Cache-Control', shouldCache ? 'public, max-age=300' : 'no-store');

  return res.status(upstream.status).send(responseText);
}

module.exports = function createProxyRouter() {
  const router = Router();

  router.options('/', (req, res) => {
    res.status(204)
      .set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      })
      .end();
  });

  router.get('/', async (req, res) => {
    const target = req.query.target;

    if (target) {
      return proxyAudioStream(target, req, res);
    }

    const source = req.query.source;
    const types = req.query.types;

    // ── 本地已下载文件（已下载资源管理）─────────────────────────────────────
    // id 形如 file:<相对 MUSIC_DOWNLOAD_DIR 的路径>。门户外壳的常驻音乐引擎
    // （packages/shall music-engine）通过本接口解析播放地址，与 SPA 本地的
    // resolvePlayUrl server-local 分支语义一致：不走 providers 链，直接给
    // serve 流地址。返回 /music 前缀的绝对路径（引擎 wrapStream 对非
    // http(s) URL 原样保留，audio.src 相对文档解析即落在音乐应用子路径）。
    if (source === 'server-local' && types === 'url') {
      return proxyServerLocalUrl(req, res);
    }

    // ── 本地音乐源（gdstudio 已下线的源在这里直连实现）──────────────────────
    const provider = source ? getProvider(source) : null;
    if (provider && types === 'download' && provider.url) {
      try {
        const info = await provider.url(
          String(req.query.id || ''),
          String(req.query.br || '')
        );
        const extension = /^[a-z0-9]{1,8}$/i.test(String(info.ext || ''))
          ? String(info.ext).toLowerCase()
          : 'm4a';
        const filename = `${String(req.query.filename || 'music')}.${extension}`;
        return proxyAudioStream(info.url, req, res, { filename, headers: info.headers });
      } catch (err) {
        console.error('[LocalProvider download]', err.message || err);
        return res.status(400).json({ error: err.message || 'download failed' });
      }
    }
    if (provider && types && provider[types]) {
      return proxyLocalProvider(provider, types, req, res);
    }

    // 封面直链兜底：pic_id 为完整 URL 时转发（适用于本地源封面）。
    // http 封面必须经代理流式转发：https 站点下 <img> 直接 302 到 http 会被混合内容拦截
    if (types === 'pic' && /^https?:\/\//.test(String(req.query.id || ''))) {
      const picUrl = String(req.query.id);
      if (/^https:/i.test(picUrl)) return res.redirect(picUrl);
      return proxyAudioStream(picUrl, req, res);
    }

    // 封面统一 302：gdstudio 的 types=pic 返回 JSON {url} 而非图片二进制，
    // 前端 <img> 无法直接使用——这里解析出真实图片地址后重定向
    if (types === 'pic') {
      return proxyPicRedirect(req, res);
    }

    // 重建完整 URL（含查询参数）给缓存 key 使用
    const fullUrl = `http://localhost${req.originalUrl}`;
    return proxyApiRequest(fullUrl, req, res);
  });

  return router;
};

/** server-local 已下载文件的播放地址解析：file:<相对路径> → serve 流直链 */
async function proxyServerLocalUrl(req, res) {
  const publicPrefix = (process.env.MUSIC_PUBLIC_PREFIX || '/music').replace(/\/+$/, '') || '';
  const id = String(req.query.id || '');
  if (!id.startsWith('file:')) {
    return res.status(400).json({ error: 'id 必须为 file:<相对路径>' });
  }
  const rel = id.slice('file:'.length);
  const { resolveWithin } = require('./download-library');
  const root = process.env.MUSIC_DOWNLOAD_DIR || '/downloads/music';
  const abs = resolveWithin(root, rel);
  if (!abs) {
    return res.status(400).json({ error: '非法路径' });
  }
  const stat = await require('node:fs/promises').stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) {
    return res.status(404).json({ error: '文件不存在（可能已被删除）' });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(
    JSON.stringify({
      url: `${publicPrefix}/api/download/serve?path=${encodeURIComponent(rel)}`,
      br: '320',
      size: stat.size,
    })
  );
}

/** gdstudio 封面解析重定向：JSON {url} → 302 真实图片地址 */
async function proxyPicRedirect(req, res) {
  const fullUrl = `http://localhost${req.originalUrl}`;
  const cacheKey = buildCacheKey(fullUrl);

  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached.body);
      if (data && data.url) return res.redirect(data.url);
    } catch { /* 缓存损坏走回源 */ }
  }

  try {
    const upstreamUrl = new URL(API_BASE_URL);
    new URL(fullUrl).searchParams.forEach((value, key) => {
      if (['target', 'callback', 's', 'nocache'].includes(key)) return;
      upstreamUrl.searchParams.set(key, value);
    });
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await upstream.text();
    const data = JSON.parse(text);
    if (!upstream.ok || !data || !data.url) {
      return res.status(502).send('Cover resolve error');
    }
    cache.set(cacheKey, { body: text, contentType: 'application/json; charset=utf-8' }, 3600);
    return res.redirect(data.url);
  } catch (err) {
    console.error('[Proxy Pic]', err.message || err);
    return res.status(502).send('Cover resolve error');
  }
}

/** 本地源请求处理：与上游一致的响应结构 + 同样的 5 分钟缓存策略 */
async function proxyLocalProvider(provider, types, req, res) {
  const fullUrl = `http://localhost${req.originalUrl}`;
  const cacheKey = buildCacheKey(fullUrl);
  const bypassCache = req.query.nocache === 'true';

  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType || 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Cache-Status', 'HIT');
      res.setHeader('Access-Control-Expose-Headers', 'X-Cache-Status');
      return res.send(cached.body);
    }
  }

  try {
    let body;
    if (types === 'search') {
      const list = await provider.search(
        req.query.name || '',
        parseInt(req.query.count, 10) || 20,
        parseInt(req.query.pages, 10) || 1
      );
      body = JSON.stringify(list);
    } else if (types === 'url') {
      const info = await provider.url(
        String(req.query.id || ''),
        String(req.query.br || '')
      );
      body = JSON.stringify(info);
    } else if (types === 'lyric') {
      const info = await provider.lyric(String(req.query.id || ''));
      body = JSON.stringify(info);
    } else if (types === 'pic') {
      // 本地源封面均为直链：优先 provider 解析，否则 id 本身是 URL
      const picUrl = provider.pic
        ? await provider.pic(String(req.query.id || ''))
        : String(req.query.id || '');
      if (/^https?:\/\//.test(picUrl)) return res.redirect(picUrl);
      return res.status(404).send('No cover');
    } else {
      return res.status(400).send('Unsupported types');
    }

    const isEmptyResult = body.trim() === '[]';
    const shouldCache = !isEmptyResult && !bypassCache;
    if (shouldCache) {
      cache.set(cacheKey, { body, contentType: 'application/json; charset=utf-8' }, 300);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Cache-Status');
    res.setHeader('Cache-Control', shouldCache ? 'public, max-age=300' : 'no-store');
    return res.send(body);
  } catch (err) {
    console.error(`[LocalProvider ${types}]`, err.message || err);
    // 与上游失败语义对齐：搜索失败返回空数组，其他返回 400
    if (types === 'search') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send('[]');
    }
    return res.status(400).json({ error: err.message || 'local provider error' });
  }
}
