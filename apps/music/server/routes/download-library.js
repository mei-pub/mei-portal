/**
 * 已下载资源管理 —— MUSIC_DOWNLOAD_DIR 磁盘曲库的查看 / 删除 / 回放
 *
 *   GET    /api/download/library?…          → { tasks, files }
 *     tasks = 服务端下载任务表（进行中 + 近期已结束，复用 server-download 的任务结构）
 *     files = 磁盘扫描 MUSIC_DOWNLOAD_DIR（目录名=歌手，文件名「歌名 - 源.ext」解析歌名）
 *   DELETE /api/download/library?path=<相对路径> → { removed:true }
 *     删除单个文件；歌手目录清空后顺带删除目录；成功后若
 *   GET    /api/download/serve?path=<相对路径>  → 流式回放（支持 Range 206/200）
 *
 * 防穿越（强约束）：
 *   - 相对路径 resolve 后必须位于 MUSIC_DOWNLOAD_DIR 内（拒绝 ../、绝对路径、反斜杠、空字节）
 *   - realpath 校验符号链接逃逸（链接目标不在下载根目录内 → 拒绝）
 *   - 扫描只认 root/<歌手>/<文件> 两层结构，root 直接落地的文件与隐藏文件一律忽略
 *
 * 鉴权：本路由挂在受 auth 中间件保护的 /api/download 下，与 POST /api/download/server 一致。
 */

'use strict';

const { Router } = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const { publicView } = require('./server-download');

const DEFAULT_DOWNLOAD_ROOT = '/downloads/music';
const MAX_LIBRARY_TASKS = 50;

// 音频扩展名白名单（扫描 serve 共用）
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'webm']);

const CONTENT_TYPE_BY_EXT = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

// ─── 纯逻辑（可单测，无 IO）────────────────────────────────────────────────────

/** 文件名（不含扩展名）解析歌名：「歌名 - 源」按最后一个 " - " 切分 */
function parseAudioFileName(base) {
  const s = String(base == null ? '' : base);
  const idx = s.lastIndexOf(' - ');
  if (idx > 0) return { name: s.slice(0, idx), source: s.slice(idx + 3) };
  return { name: s, source: '' };
}

function contentTypeForExt(ext) {
  return CONTENT_TYPE_BY_EXT[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

/**
 * 纯路径防穿越：相对路径拼接后必须落在 root 内。
 * 返回规范绝对路径；非法（空 / 绝对 / ../ 逃逸 / 反斜杠 / 空字节）返回 null。
 */
function resolveWithin(root, relPath) {
  const s = String(relPath == null ? '' : relPath);
  if (!s || s.includes('\0') || s.includes('\\') || path.isAbsolute(s)) return null;
  const rootAbs = path.resolve(String(root));
  const target = path.resolve(rootAbs, s);
  const rel = path.relative(rootAbs, target);
  if (!rel || rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/**
 * Range 头解析（RFC 7233 单区间，音频流够用）：
 *   返回 null       → 无 Range，回 200 全量
 *   返回 {start,end} → 回 206
 *   返回 'invalid'   → 语法错或区间不满足，回 416（Content-Range 形如 bytes 斜杠 size）
 */
function parseRangeHeader(header, size) {
  const s = String(header || '').trim();
  if (!s) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(s);
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  if (m[1] === '') {
    // 后缀区间：最后 N 字节
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    if (n >= size) return { start: 0, end: size - 1 };
    return { start: size - n, end: size - 1 };
  }
  const start = parseInt(m[1], 10);
  if (!Number.isFinite(start) || start < 0 || start >= size) return 'invalid';
  const end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  if (!Number.isFinite(end) || end < start) return 'invalid';
  return { start, end };
}

// ─── 带盘校验的解析（防符号链接逃逸）──────────────────────────────────────────

/**
 * 纯路径校验 + realpath 双保险。
 * 返回 { abs, exists }；路径非法或符号链接逃逸 → null。
 * exists=false 表示路径合法但文件不存在（DELETE 回 404、serve 回 404）。
 */
async function safeResolve(root, relPath) {
  const abs = resolveWithin(root, relPath);
  if (!abs) return null;
  const rootAbs = path.resolve(String(root));
  const realRoot = await fsp.realpath(rootAbs).catch(() => rootAbs);
  const real = await fsp.realpath(abs).catch(() => null);
  if (!real) return { abs, exists: false };
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null; // 符号链接逃逸
  return { abs, exists: true };
}

// ─── 磁盘扫描 ─────────────────────────────────────────────────────────────────

/**
 * 扫描下载根目录：<root>/<歌手>/<文件.ext>。
 * 只认两层结构；跳过隐藏文件 / 非音频扩展名 / 下载中的 .part 临时文件。
 */
async function scanLibrary(root, deps = {}) {
  const readdirImpl = deps.readdirImpl || ((dir) => fsp.readdir(dir, { withFileTypes: true }));
  const statImpl = deps.statImpl || ((p) => fsp.stat(p));
  const rootAbs = path.resolve(String(root));
  const files = [];

  let artists;
  try {
    artists = await readdirImpl(rootAbs);
  } catch {
    return files; // 目录不存在 = 空曲库
  }

  for (const artistEntry of artists) {
    // withFileTypes 下符号链接目录 isDirectory()=false，天然不会跟着链接逃逸
    if (!artistEntry.isDirectory()) continue;
    const artist = artistEntry.name;
    let entries;
    try {
      entries = await readdirImpl(path.join(rootAbs, artist));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fileName = entry.name;
      if (fileName.startsWith('.')) continue; // 隐藏文件与 .part 临时文件
      const ext = path.extname(fileName).slice(1).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;
      const full = path.join(rootAbs, artist, fileName);
      const stat = await statImpl(full).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const base = fileName.slice(0, fileName.length - ext.length - 1);
      const parsed = parseAudioFileName(base);
      files.push({
        artist,
        name: parsed.name,
        source: parsed.source, // 落盘文件名「歌名 - 源.ext」中的源短码（netease/qq/...）
        fileName,
        path: `${artist}/${fileName}`,
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
      });
    }
  }

  files.sort((a, b) =>
    a.artist === b.artist
      ? a.fileName.localeCompare(b.fileName)
      : a.artist.localeCompare(b.artist)
  );
  return files;
}

// ─── 任务视图（契约 1 的 tasks 结构）──────────────────────────────────────────

/** speed：running+downloading 时按已接收字节 / 下载经过秒数估算（B/s），其余 0 */
function taskView(task) {
  const view = { ...publicView(task) };
  let speed = 0;
  if (task.status === 'running' && task.phase === 'downloading' && task.downloadStartedAt) {
    const secs = Math.max(0.5, (Date.now() - task.downloadStartedAt) / 1000);
    speed = Math.round((task.received || 0) / secs);
  }
  view.speed = speed;
  return view;
}

// ─── 路由 ─────────────────────────────────────────────────────────────────────

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = function createDownloadLibraryRouter(deps = {}) {
  const router = Router();
  const taskManager = deps.taskManager || null;
  const downloadRoot = () =>
    path.resolve(deps.downloadRoot || process.env.MUSIC_DOWNLOAD_DIR || DEFAULT_DOWNLOAD_ROOT);

  router.options('/', (req, res) => {
    res.status(204).set(JSON_HEADERS).end();
  });
  router.options('/library', (req, res) => {
    res.status(204).set(JSON_HEADERS).end();
  });
  router.options('/serve', (req, res) => {
    res.status(204).set(JSON_HEADERS).end();
  });

  // GET /api/download/library —— 任务表（进行中 + 近期）+ 磁盘文件
  router.get('/library', async (req, res) => {
    try {
      const files = await scanLibrary(downloadRoot());
      const tasks = taskManager && typeof taskManager.list === 'function'
        ? taskManager.list().slice(0, MAX_LIBRARY_TASKS).map(taskView)
        : [];
      return res.set(JSON_HEADERS).json({ tasks, files });
    } catch (err) {
      console.error('[DownloadLibrary]', err.message || err);
      return res.status(500).set(JSON_HEADERS).json({ error: '扫描下载目录失败' });
    }
  });

  // DELETE /api/download/library?path=<相对路径> —— 删单文件 + 清空歌手目录
  router.delete('/library', async (req, res) => {
    const rel = String(req.query.path || '');
    let safe;
    try {
      safe = await safeResolve(downloadRoot(), rel);
    } catch {
      safe = null;
    }
    if (!safe) return res.status(400).set(JSON_HEADERS).json({ error: '非法路径' });
    if (!safe.exists) return res.status(404).set(JSON_HEADERS).json({ error: '文件不存在' });
    try {
      await fsp.unlink(safe.abs);
    } catch (err) {
      return res.status(500).set(JSON_HEADERS).json({ error: `删除失败：${err.message || err}` });
    }
    // 歌手目录空了顺带删目录（rmdir 只删空目录，非空会失败并被吞掉）
    const dir = path.dirname(safe.abs);
    const rest = await fsp.readdir(dir).catch(() => null);
    if (rest && rest.length === 0) await fsp.rmdir(dir).catch(() => {});
    return res.set(JSON_HEADERS).json({ removed: true });
  });

  // GET /api/download/serve?path=<相对路径> —— 流式回放（Range 206/200）
  router.get('/serve', async (req, res) => {
    const rel = String(req.query.path || '');
    let safe;
    try {
      safe = await safeResolve(downloadRoot(), rel);
    } catch {
      safe = null;
    }
    if (!safe) return res.status(400).set(JSON_HEADERS).json({ error: '非法路径' });
    if (!safe.exists) return res.status(404).set(JSON_HEADERS).json({ error: '文件不存在' });

    let stat;
    try {
      stat = await fsp.stat(safe.abs);
    } catch {
      return res.status(404).set(JSON_HEADERS).json({ error: '文件不存在' });
    }
    if (!stat.isFile()) return res.status(400).set(JSON_HEADERS).json({ error: '不是文件' });

    const size = stat.size;
    const ext = path.extname(safe.abs).slice(1).toLowerCase();
    const etag = `"${size}-${Math.round(stat.mtimeMs)}"`;

    // If-None-Match 命中 → 304（浏览器拖动进度条时的重复 Range 探测可省流）
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).set({
        ETag: etag,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      }).end();
    }

    const range = parseRangeHeader(req.headers.range, size);
    if (range === 'invalid') {
      return res.status(416).set({
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
      }).end();
    }

    res.set({
      'Content-Type': contentTypeForExt(ext),
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });

    const opts = range ? { start: range.start, end: range.end } : {};
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
    }

    const stream = fs.createReadStream(safe.abs, opts);
    stream.on('error', (err) => {
      console.error('[DownloadServe]', err.message || err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    try {
      await pipeline(stream, res);
    } catch { /* 客户端提前断开（拖动进度条很常见），无需处理 */ }
  });

  return router;
};

// 纯逻辑导出（供 node:test 直接单测，不依赖 express / 网络）
module.exports.parseAudioFileName = parseAudioFileName;
module.exports.contentTypeForExt = contentTypeForExt;
module.exports.resolveWithin = resolveWithin;
module.exports.safeResolve = safeResolve;
module.exports.parseRangeHeader = parseRangeHeader;
module.exports.scanLibrary = scanLibrary;
module.exports.taskView = taskView;
