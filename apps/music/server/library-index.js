'use strict';

// 曲库源索引持久化（.library-index.json）
//
// download-library 的文件扫描元数据只有「歌名 - 源」解析结果、没有 song.id；
// 下载任务表又是内存态（进程重启即空）。没有这份索引，服务重启后历史文件的
// 「复制链接」（音源站歌曲页地址）永远构造不出来，只能回退「复制路径」。
// 下载完成（含命中已存在文件）时按落盘相对路径 <歌手>/<文件> 记录 song.id/
// /source，形成跨重启的源地址事实源；删除文件时同步移除。JSON 单文件 +
// 1s 防抖原子落盘（tmp+rename），尽力而为不阻塞下载主链路。

const fsp = require('node:fs/promises');
const path = require('node:path');

const INDEX_FILE = '.library-index.json';

const state = {
  map: new Map(),
  loadedRoots: new Set(),
  saveTimer: null,
  saveChain: Promise.resolve(),
};

async function load(root) {
  const rootAbs = path.resolve(String(root || ''));
  if (!rootAbs || rootAbs === '/' || state.loadedRoots.has(rootAbs)) return;
  state.loadedRoots.add(rootAbs);
  try {
    const raw = await fsp.readFile(path.join(rootAbs, INDEX_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    for (const [key, value] of Object.entries(parsed || {})) {
      if (value && typeof value === 'object' && value.id !== undefined && value.id !== null) {
        state.map.set(key, value);
      }
    }
  } catch {
    // 无索引文件 / 解析失败 = 空索引起步
  }
}

function scheduleSave(rootAbs) {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => void save(rootAbs), 1000);
  if (typeof state.saveTimer.unref === 'function') state.saveTimer.unref();
}

async function save(rootAbs) {
  state.saveTimer = null;
  const file = path.join(rootAbs, INDEX_FILE);
  const payload = Object.fromEntries(state.map);
  state.saveChain = state.saveChain
    .then(async () => {
      try {
        await fsp.writeFile(`${file}.tmp`, JSON.stringify(payload, null, 2), 'utf8');
        await fsp.rename(`${file}.tmp`, file);
      } catch {
        // 磁盘不可写等：下次 record 再试，不阻塞下载
      }
    })
    .catch(() => {});
}

/** 源信息是否可用（id 非空字符串才可构造歌曲页链接） */
function usable(song) {
  return Boolean(
    song &&
      song.id !== undefined &&
      song.id !== null &&
      String(song.id).trim() !== '',
  );
}

/**
 * 记录（或刷新）一个完成文件的源信息。
 * @param root    下载根目录（用于定位索引文件）
 * @param relPath 落盘相对路径 <歌手>/<文件.ext>
 * @param song    { id, source, name, artist }
 */
async function record(root, relPath, song) {
  const rootAbs = path.resolve(String(root || ''));
  if (!rootAbs || rootAbs === '/' || !usable(song)) return;
  await load(rootAbs);
  state.map.set(String(relPath || ''), {
    id: String(song.id),
    source: String(song.source || ''),
    name: String(song.name || ''),
    artist: String(song.artist || ''),
    at: Date.now(),
  });
  scheduleSave(rootAbs);
}

/** 查询落盘相对路径的源信息 */
function lookup(relPath) {
  const info = state.map.get(String(relPath || ''));
  return info && usable(info) ? info : null;
}

/** 删除文件时同步移除索引（静默容错） */
async function forget(root, relPath) {
  const rootAbs = path.resolve(String(root || ''));
  if (!rootAbs || rootAbs === '/') return;
  await load(rootAbs);
  if (state.map.delete(String(relPath || ''))) scheduleSave(rootAbs);
}

module.exports = { record, lookup, forget, load, INDEX_FILE };
