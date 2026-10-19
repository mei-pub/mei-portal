'use strict';

// 曲库历史文件源回填（.library-index.json 补写 song.id）
//
// 背景：下载完成时的 recordSource 只覆盖「任务产出的文件」；更早的历史文件
// （任务表内存态重启即空、.library-index.json 尚未引入前落盘）没有源 id，
// 前端「复制链接」构造不出音源站歌曲页地址（用户契约：复制链接恒=源链接，
// 本地流直链不许冒充）。按落盘文件名解析的歌名+源（歌手=目录名）调音源
// 搜索，归一化歌名全等 + 歌手交集命中第一条即把 {id, source} 写进源索引
// —— library-index 是单例，GET /library 的 enrich（join 任务表 miss 后
// lookup）与「复制链接」自动生效，无需额外 API。
//
// 触发点：
//   1. 服务启动 5s 后全扫一次（启动即逐步补齐历史文件）；
//   2. 每次 GET /api/download/library 托底触发（60s 全局节流，in-flight 去重）。
// 失败容忍：单文件搜索失败/无命中静默跳过；同一文件 10 分钟内不重复尝试；
// 串行执行 + 源间 300ms 间隔防上游压制；绝不阻塞请求路径。
//
// 匹配防错配：歌名归一化必须全等（第一轮用全名，第二轮剥掉尾部括号注记
// 如「搁浅（原唱：周杰伦）」重试）；歌手必须与目录名 token 相交——宁可
// 补不上（复制兜底如实提示），不做跨作品近似匹配。

const path = require('node:path');

const { getProvider } = require('./providers');
const libraryIndex = require('./library-index');
const libraryRoute = require('./routes/download-library');

const API_BASE_URL =
  process.env.API_BASE_URL || 'https://music-api.gdstudio.xyz/api.php';

const SEARCH_COUNT = 20;
const RETRY_AFTER_MS = 10 * 60 * 1000; // 无命中文件的重试冷却
const SEARCH_GAP_MS = 300; // 相邻搜索间隔（单文件两轮查询间也隔）
const KICK_MIN_INTERVAL_MS = 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 归一化：仅保留字母数字（去空白/全半角标点/符号），小写 */
function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 剥掉歌名尾部的括号注记（搁浅(原唱：周杰伦) → 搁浅） */
function stripParenthetical(name) {
  return String(name || '')
    .replace(/[(（][^()（）]*[)）]\s*$/, '')
    .trim();
}

/** 目录名（歌手）拆成可比 token：孙颖 (SunYing) → [孙颖, SunYing] */
function artistTokens(artist) {
  const raw = String(artist || '')
    .split(/[\s()（）/、,，&+·]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (raw.length === 0) return [''];
  return raw;
}

/** 命中结果 artist 是否与目录名 token 相交（/providers 约定 artist 为数组） */
function artistMatch(dirArtist, hitArtist) {
  const hitJoined = normalize(
    Array.isArray(hitArtist) ? hitArtist.join(' ') : hitArtist || '',
  );
  if (!hitJoined) return false;
  return artistTokens(dirArtist).some((t) =>
    hitJoined.includes(normalize(t)),
  );
}

const state = {
  running: false,
  lastKick: 0,
  attempts: new Map(), // relPath -> 上次尝试时间（进程内记忆；重启后重试无害）
};

/** 单次搜索（本地 provider 优先，未实现回退 gdstudio 上游；失败返回 []） */
async function searchSongs(source, name) {
  const provider = getProvider(source);
  if (provider && provider.search) {
    try {
      return await provider.search(String(name || ''), SEARCH_COUNT, 1);
    } catch (err) {
      console.warn(
        `[LibraryBackfill] 本地源搜索失败 ${source}:`,
        (err && err.message) || err,
      );
      return [];
    }
  }
  try {
    const url =
      `${API_BASE_URL}?types=search&source=${encodeURIComponent(String(source || ''))}` +
      `&name=${encodeURIComponent(String(name || ''))}&count=${SEARCH_COUNT}&pages=1`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; mei-music-backfill)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * 单文件解析：逐轮查询（全名 → 剥括号注记 → 剥名+首个歌手 token 重组），
 * 命中即写源索引。三轮判定完全一致（歌名归一化全等 + 歌手交集），
 * 第三轮只是查询串差异（如「Only one」搜不到时用「Only one BoA」）。
 * @returns {{ hit: boolean, id?: string }}
 */
async function resolveOne(rootAbs, file) {
  const baseName = file.name || parseAudioFileName(file.fileName).name;
  const core = stripParenthetical(baseName);
  const firstArtist = artistTokens(file.artist)[0];
  const queries = [
    { q: baseName, match: normalize(baseName) },
  ];
  if (core && normalize(core) !== normalize(baseName)) {
    queries.push({ q: core, match: normalize(core) });
  }
  if (core && firstArtist && normalize(firstArtist) !== normalize(core)) {
    queries.push({ q: `${core} ${firstArtist}`, match: normalize(core) });
  }
  for (const { q, match } of queries) {
    const hits = await searchSongs(file.source, q);
    const found = (Array.isArray(hits) ? hits : [])
      .filter(
        (h) =>
          h &&
          h.id !== undefined &&
          h.id !== null &&
          `${h.id}` !== '' &&
          normalize(h.name) === match,
      )
      .find((h) => artistMatch(file.artist, h.artist));
    if (found) {
      await libraryIndex.record(rootAbs, file.path, {
        id: `${found.id}`,
        source: file.source,
        name: found.name,
        artist: file.artist,
      });
      return { hit: true, id: `${found.id}` };
    }
    await sleep(SEARCH_GAP_MS);
  }
  return { hit: false };
}

/** 一轮全量回填：只处理「有源短码 + 索引 miss + 冷却已过」的文件 */
async function runPass(rootAbs) {
  await libraryIndex.load(rootAbs);
  const files = await libraryRoute.scanLibrary(rootAbs);
  const now = Date.now();
  const targets = files.filter(
    (f) =>
      f &&
      f.source &&
      libraryIndex.lookup(f.path) === null &&
      now - (state.attempts.get(f.path) || 0) > RETRY_AFTER_MS,
  );
  if (targets.length === 0) return 0;
  console.log(`[LibraryBackfill] 待补源 ${targets.length} 个文件，开始回填`);
  let hitCount = 0;
  for (const file of targets) {
    try {
      const res = await resolveOne(rootAbs, file);
      state.attempts.set(file.path, Date.now());
      if (res.hit) {
        hitCount += 1;
        console.log(
          `[LibraryBackfill] 补源命中 ${file.path} -> ${file.source}/${res.id}`,
        );
      }
    } catch (err) {
      console.warn(
        `[LibraryBackfill] ${file.path}:`,
        (err && err.message) || err,
      );
    }
  }
  console.log(`[LibraryBackfill] 本轮命中 ${hitCount} / ${targets.length}`);
  return hitCount;
}

/**
 * @param {{ root?: string }} deps 根目录（默认 MUSIC_DOWNLOAD_DIR 或 /downloads/music）
 * @returns {{ kick: (opts?: { minIntervalMs?: number }) => void }}
 */
function createLibraryBackfill(deps = {}) {
  const rootAbs = path.resolve(
    deps.root || process.env.MUSIC_DOWNLOAD_DIR || '/downloads/music',
  );
  // fire-and-forget：调用方（路由/启动钩子）不等结果
  const kick = (opts = {}) => {
    const now = Date.now();
    if (state.running) return false;
    if (
      now - state.lastKick <
      (typeof opts.minIntervalMs === 'number'
        ? opts.minIntervalMs
        : KICK_MIN_INTERVAL_MS)
    ) {
      return false;
    }
    state.lastKick = now;
    state.running = true;
    void (async () => {
      try {
        await runPass(rootAbs);
      } finally {
        state.running = false;
      }
    })().catch(() => {});
    return true;
  };
  return { kick };
}

// 纯逻辑导出（供 node:test 校验匹配规则，不依赖网络）
module.exports.normalize = normalize;
module.exports.stripParenthetical = stripParenthetical;
module.exports.artistMatch = artistMatch;
module.exports.artistTokens = artistTokens;
module.exports.createLibraryBackfill = createLibraryBackfill;
