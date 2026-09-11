/**
 * 服务端下载接口 —— 把歌曲下载到服务器本地磁盘
 *
 *   POST /api/download/server            创建下载任务（异步执行，立即返回任务 id）
 *     body: { source, id, name, artist, quality? }
 *   GET  /api/download/server/status?id=  轮询任务进度
 *
 * 保存路径：MUSIC_DOWNLOAD_DIR（默认 /downloads/music，容器内为宿主映射卷）
 *           / <消毒歌手> / <消毒歌名> - <source>.<ext>
 *
 * 实现要点：
 *   - 复用 providers 链解析直链（本地源内部已含 probeAudioUrl 校验与音质降级；
 *     netease/joox 等无本地源的回退 gdstudio 上游，与 /proxy types=url 一致）
 *   - 解析后再用 probeAudioUrl 做一次终链校验（302 中转 → 最终直链 + 总大小）
 *   - 流式抓取（fetch + pipeline），不一次性 buffer 大文件，不阻塞事件循环
 *   - 临时文件 + rename 原子落盘；同名同大小直接复用已存在文件
 *   - 任务表为内存 Map：running / done / error，含 received / total / percent
 *   - 鉴权沿用全局 auth 中间件（本路由挂载在受保护区，与 /api/storage 同级）
 */

'use strict';

const { Router } = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const { getProvider } = require('../providers');
const { probeAudioUrl } = require('../providers/verify');

const DEFAULT_DOWNLOAD_ROOT = '/downloads/music';
const CONNECT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 120 * 1000; // 无数据看门狗：超过即中止（MUSIC_DOWNLOAD_TIMEOUT 秒可调）
const MAX_TASKS = 200; // 任务表上限，超出后淘汰最早结束的任务
const API_BASE_URL = process.env.API_BASE_URL || 'https://music-api.gdstudio.xyz/api.php';
const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// provider 返回的 headers 只透传安全键（与 proxy.js 的上游头白名单一致）
const SAFE_HEADER_KEYS = new Set([
  'user-agent', 'accept', 'accept-language', 'sec-fetch-mode', 'origin', 'referer',
]);

// ─── 纯逻辑（可单测）──────────────────────────────────────────────────────────

/** 文件名/目录名段消毒：剔除路径分隔与文件系统非法字符、控制字符，折叠空白 */
function sanitizeSegment(name, fallback = 'unknown') {
  let s = String(name == null ? '' : name);
  s = Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c > 31 && c !== 127; }).join(""); // 剔除控制字符
  s = s.replace(/[/\\:*?"<>|]/g, ''); // 文件系统非法字符（含路径分隔，杜绝目录穿越）
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, ''); // Windows 不允许结尾点/空格
  if (s.length > 100) s = s.slice(0, 100).replace(/[. ]+$/, '');
  return s || fallback;
}

/** 目标路径：<root>/<消毒歌手>/<消毒歌名> - <source>.<ext>（source 后缀防跨源同名冲突） */
function buildTargetPath(root, song, ext = 'mp3') {
  const artist = sanitizeSegment(song && song.artist, '未知歌手');
  const name = sanitizeSegment(song && song.name, '未知歌曲');
  const source = sanitizeSegment(song && song.source, 'unknown');
  const safeExt = /^[a-z0-9]{1,8}$/i.test(String(ext)) ? String(ext).toLowerCase() : 'mp3';
  return path.join(String(root), artist, `${name} - ${source}.${safeExt}`);
}

const EXT_BY_CONTENT_TYPE = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'video/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/flac': 'flac',
};

/** 扩展名：provider 显式 ext 优先，其次探测到的 Content-Type，兜底 mp3 */
function pickExt(info, probeResult) {
  if (info && /^[a-z0-9]{1,8}$/i.test(String(info.ext || ''))) {
    return String(info.ext).toLowerCase();
  }
  const type = String((probeResult && probeResult.type) || '')
    .split(';')[0].trim().toLowerCase();
  if (EXT_BY_CONTENT_TYPE[type]) return EXT_BY_CONTENT_TYPE[type];
  return 'mp3';
}

function createId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 任务表：内存 Map，超限先淘汰已结束任务（running 永不淘汰） */
function createTaskManager(maxTasks = MAX_TASKS) {
  const tasks = new Map();
  const prune = () => {
    if (tasks.size <= maxTasks) return;
    for (const [id, task] of tasks) {
      if (tasks.size <= maxTasks) break;
      if (task.status !== 'running') tasks.delete(id);
    }
  };
  return {
    create(song, quality) {
      const task = {
        id: createId(),
        song: {
          source: String((song && song.source) || ''),
          id: String((song && song.id) || ''),
          name: String((song && song.name) || ''),
          artist: String((song && song.artist) || ''),
        },
        quality: String(quality || '320'),
        status: 'running', phase: 'resolving',
        received: 0, total: 0, percent: 0, size: 0,
        path: '', error: '', existed: false,
        createdAt: Date.now(), finishedAt: 0, downloadStartedAt: 0,
      };
      tasks.set(task.id, task);
      prune();
      return task;
    },
    get(id) {
      return tasks.get(String(id)) || null;
    },
    /** 同一首歌已有 running 任务则复用（防重复点击产生双份下载） */
    findRunning(song) {
      const source = String((song && song.source) || '');
      const id = String((song && song.id) || '');
      for (const task of tasks.values()) {
        if (task.status === 'running' && task.song.source === source && task.song.id === id) {
          return task;
        }
      }
      return null;
    },
    /** 全量任务视图（新建在前；已下载曲库 GET /library 用，含 running + 近期） */
    list() {
      return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    count() {
      return tasks.size;
    },
  };
}

// ─── 直链解析（复用 providers 链 + gdstudio 回退）────────────────────────────

/**
 * 解析直链：本地源（qq/kugou/kuwo/migu/youtube）走 provider.url（内部含
 * probeAudioUrl 校验与降级链）；无本地源的（netease/joox/bilibili）回退
 * gdstudio 上游（与 /proxy types=url 同一语义），按音质 320 → 192 → 128 降级。
 */
async function resolveUpstreamInfo(song, quality, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const getProviderFn = deps.getProvider || getProvider;
  const chain = [...new Set([String(quality || '320'), '192', '128'])];

  const provider = getProviderFn(song.source);
  if (provider && typeof provider.url === 'function') {
    let lastError = null;
    for (const br of chain) {
      try {
        const info = await provider.url(String(song.id), br);
        if (info && typeof info.url === 'string' && /^https?:\/\//.test(info.url)) return info;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('播放地址解析失败');
  }

  for (const br of chain) {
    const url =
      `${API_BASE_URL}?types=url&id=${encodeURIComponent(String(song.id))}` +
      `&source=${encodeURIComponent(String(song.source))}&br=${encodeURIComponent(br)}`;
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': UA_CHROME, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.url === 'string' && /^https?:\/\//.test(data.url)) {
        return { url: data.url, br, size: Number(data.size) || 0 };
      }
    } catch { /* 尝试下一档码率 */ }
  }
  throw new Error('播放地址解析失败');
}

function normalizeUpstreamHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_HEADER_KEYS.has(String(key).toLowerCase()))
  );
}

/** 按直链域名构造抓取头（Referer/UA 防盗链，与 proxy.js 的转发头逻辑一致） */
function audioFetchHeaders(hostname, provided) {
  const headers = { 'User-Agent': UA_CHROME, ...normalizeUpstreamHeaders(provided) };
  if (/(^|\.)kuwo\.cn$/i.test(hostname)) headers.Referer = 'https://www.kuwo.cn/';
  else if (/(^|\.)qq\.com$/i.test(hostname)) headers.Referer = 'https://y.qq.com/';
  else if (/(^|\.)googlevideo\.com$/i.test(hostname)) {
    headers['User-Agent'] = UA_CHROME;
    headers['Origin'] = 'https://www.youtube.com';
    headers['Referer'] = 'https://www.youtube.com/';
  }
  return headers;
}

function refererFor(url) {
  try {
    const hostname = new URL(url).hostname;
    if (/(^|\.)kuwo\.cn$/i.test(hostname)) return 'https://www.kuwo.cn/';
    if (/(^|\.)qq\.com$/i.test(hostname)) return 'https://y.qq.com/';
  } catch { /* 非法 URL 由后续探测兜底 */ }
  return undefined;
}

// ─── 任务执行（后台异步，绝不抛出；结果写回任务表）────────────────────────────

async function runDownloadTask(task, ctx = {}) {
  const root =
    ctx.downloadRoot || process.env.MUSIC_DOWNLOAD_DIR || DEFAULT_DOWNLOAD_ROOT;
  const fetchImpl = ctx.fetchImpl || fetch;
  const probeImpl = ctx.probeImpl || probeAudioUrl;
  const resolveImpl = ctx.resolveImpl || resolveUpstreamInfo;
  const idleTimeoutMs =
    Number.isFinite(ctx.idleTimeoutMs) && ctx.idleTimeoutMs > 0
      ? ctx.idleTimeoutMs
      : (parseInt(process.env.MUSIC_DOWNLOAD_TIMEOUT || '', 10) || 120) * 1000;

  const update = (patch) => Object.assign(task, patch);
  const fail = (message) =>
    update({ status: 'error', error: String(message || '下载失败'), finishedAt: Date.now() });

  // 1) 解析直链 + 终链校验（probeAudioUrl 跟随 302 拿最终直链与总大小）
  let info;
  let probeResult;
  try {
    update({ phase: 'resolving' });
    info = await resolveImpl(task.song, task.quality, ctx);
    probeResult = await probeImpl(info.url, { referer: refererFor(info.url) });
    if (!probeResult || !probeResult.url) return fail('直链校验失败（可能已过期）');
  } catch (err) {
    return fail((err && err.message) || '直链解析失败');
  }

  // 2) 目标路径与总量
  const ext = pickExt(info, probeResult);
  const targetPath = buildTargetPath(root, task.song, ext);
  const total = (probeResult && probeResult.total) || Number(info.size) || 0;
  update({ phase: 'downloading', path: targetPath, total, downloadStartedAt: Date.now() });

  // 3) 已存在且大小一致 → 直接复用
  try {
    const existed = await fsp.stat(targetPath).catch(() => null);
    if (existed && existed.isFile() && total > 0 && existed.size === total) {
      return update({
        status: 'done', existed: true,
        received: existed.size, size: existed.size, percent: 100,
        finishedAt: Date.now(),
      });
    }
  } catch { /* 覆盖下载 */ }

  // 4) 流式下载：临时文件 + rename 原子落盘；idle 看门狗超时中止
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${task.id}.part`);
  const cleanupTmp = () => fsp.rm(tmpPath, { force: true }).catch(() => {});
  // 看门狗中止时 Node 流机器会抛通用 AbortError，真实原因需自行保留
  let watchdogReason = null;

  try {
    await fsp.mkdir(dir, { recursive: true });

    const controller = new AbortController();
    let idleTimer = null;
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      const reason = new Error(`下载超时（${Math.round(idleTimeoutMs / 1000)} 秒无数据）`);
      idleTimer = setTimeout(() => {
        watchdogReason = reason;
        controller.abort(reason);
      }, idleTimeoutMs);
    };
    bumpIdle();

    const connectController = new AbortController();
    const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetchImpl(probeResult.url, {
        headers: audioFetchHeaders(new URL(probeResult.url).hostname, info.headers),
        redirect: 'follow',
        signal: AbortSignal.any([controller.signal, connectController.signal]),
      });
    } finally {
      clearTimeout(connectTimer);
    }
    if (!upstream.ok) throw new Error(`上游返回 HTTP ${upstream.status}`);

    if (!total) {
      const len = parseInt(upstream.headers.get('content-length') || '0', 10);
      if (len) update({ total: len });
    }

    let received = 0;
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        bumpIdle();
        const currentTotal = task.total || 0;
        update({
          received,
          percent: currentTotal > 0 ? Math.min(100, Math.round((received / currentTotal) * 100)) : 0,
        });
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(upstream.body),
        counter,
        fs.createWriteStream(tmpPath),
        { signal: controller.signal }
      );
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }

    const finalTotal = task.total || 0;
    if (finalTotal > 0 && received < finalTotal) throw new Error('下载不完整');

    await fsp.rename(tmpPath, targetPath);
    update({ status: 'done', received, size: received, percent: 100, finishedAt: Date.now() });
  } catch (err) {
    await cleanupTmp();
    const message = watchdogReason
      ? watchdogReason.message
      : (err && err.message) || '下载失败';
    return fail(message);
  }
}

// ─── 路由 ─────────────────────────────────────────────────────────────────────

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function publicView(task) {
  return {
    id: task.id,
    status: task.status,          // running | done | error
    phase: task.phase,            // resolving | downloading（仅 running 时有意义）
    song: task.song,
    received: task.received,
    total: task.total,
    percent: task.percent,
    path: task.path,              // 服务器上的绝对保存路径（done 时有效）
    existed: Boolean(task.existed), // true = 命中已存在的同大小文件
    size: task.size,
    error: task.error,
    finishedAt: task.finishedAt,
  };
}

module.exports = function createServerDownloadRouter(deps = {}) {
  const router = Router();
  const manager = deps.taskManager || createTaskManager(deps.maxTasks);
  const ctx = {
    downloadRoot: deps.downloadRoot,
    fetchImpl: deps.fetchImpl,
    probeImpl: deps.probeImpl,
    resolveImpl: deps.resolveImpl,
    idleTimeoutMs: deps.idleTimeoutMs,
  };

  router.options('/', (req, res) => {
    res.status(204).set(JSON_HEADERS).end();
  });

  // POST /api/download/server —— 创建任务（立即返回，后台异步执行）
  router.post('/server', async (req, res) => {
    const body = req.body || {};
    const song = {
      source: String(body.source || '').trim(),
      id: String(body.id || '').trim(),
      name: String(body.name || '').trim(),
      artist: String(body.artist || '').trim(),
    };
    const quality = String(body.quality || '320');

    if (!song.source || !song.id || !song.name) {
      return res.status(400).set(JSON_HEADERS).json({ error: '缺少 source / id / name' });
    }

    // 同曲已有 running 任务 → 复用，避免重复下载
    const running = manager.findRunning(song);
    if (running) return res.set(JSON_HEADERS).json(publicView(running));

    const task = manager.create(song, quality);
    runDownloadTask(task, ctx).catch((err) => {
      // runDownloadTask 自身不抛；此处兜底防御（防未捕获拒绝压掉进程）
      task.status = 'error';
      task.error = (err && err.message) || '下载失败';
      task.finishedAt = Date.now();
    });
    return res.set(JSON_HEADERS).json(publicView(task));
  });

  // GET /api/download/server/status?id= —— 轮询任务进度
  router.get('/server/status', (req, res) => {
    const task = manager.get(String(req.query.id || ''));
    if (!task) return res.status(404).set(JSON_HEADERS).json({ error: '任务不存在或已清理' });
    return res.set(JSON_HEADERS).json(publicView(task));
  });

  return router;
};

// 纯逻辑导出（供 node:test 直接单测，不依赖 express / 网络）
module.exports.sanitizeSegment = sanitizeSegment;
module.exports.buildTargetPath = buildTargetPath;
module.exports.pickExt = pickExt;
module.exports.createTaskManager = createTaskManager;
module.exports.resolveUpstreamInfo = resolveUpstreamInfo;
module.exports.audioFetchHeaders = audioFetchHeaders;
module.exports.runDownloadTask = runDownloadTask;
module.exports.publicView = publicView;
