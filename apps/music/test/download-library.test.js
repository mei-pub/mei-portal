// 已下载资源管理测试：
// - 纯逻辑：防穿越 resolveWithin / 文件名解析 / Range 解析 / Content-Type / 磁盘扫描
// - 路由集成：express 临时实例（127.0.0.1 随机端口，不发外网），library 结构 /
//   serve Range 206 / DELETE 正常删除 + 空目录清理 + 穿越与绝对路径拒绝
// - 前端分发：resolvePlayUrl server-local 分支（不发请求）、openMediaDownloads
//   的 postMessage / location.assign 降级
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const factory = (await import('../server/routes/download-library.js')).default;
const pure = await import('../server/routes/download-library.js');

const makeTmpRoot = () => fsp.mkdtemp(path.join(os.tmpdir(), 'mei-dl-lib-'));

// ─── 纯逻辑 ────────────────────────────────────────────────────────────────────

test('resolveWithin：合法相对路径返回绝对路径，穿越 / 绝对 / 反斜杠 / 空字节拒绝', () => {
  const r = pure.resolveWithin;
  assert.equal(r('/downloads/music', '周杰伦/晴天 - qq.mp3'), '/downloads/music/周杰伦/晴天 - qq.mp3');
  assert.equal(r('/downloads/music', 'a/b/c.flac'), '/downloads/music/a/b/c.flac');
  // 穿越样本必须拒绝
  assert.equal(r('/downloads/music', '../../etc/passwd'), null);
  assert.equal(r('/downloads/music', '周杰伦/../../etc/passwd'), null);
  assert.equal(r('/downloads/music', '/etc/passwd'), null);
  assert.equal(r('/downloads/music', 'a\\b.mp3'), null);
  assert.equal(r('/downloads/music', 'a\0b.mp3'), null);
  assert.equal(r('/downloads/music', ''), null);
  assert.equal(r('/downloads/music', null), null);
});

test('parseAudioFileName：「歌名 - 源」按最后一个 " - " 切分', () => {
  const p = pure.parseAudioFileName;
  assert.deepEqual(p('晴天 - qq'), { name: '晴天', source: 'qq' });
  assert.deepEqual(p('富士山下 - netease'), { name: '富士山下', source: 'netease' });
  assert.deepEqual(p('A - B - C'), { name: 'A - B', source: 'C' }); // 多段取最后一个
  assert.deepEqual(p('无分隔符文件'), { name: '无分隔符文件', source: '' });
});

test('contentTypeForExt：扩展名映射音频 MIME', () => {
  const c = pure.contentTypeForExt;
  assert.equal(c('mp3'), 'audio/mpeg');
  assert.equal(c('flac'), 'audio/flac');
  assert.equal(c('wav'), 'audio/wav');
  assert.equal(c('m4a'), 'audio/mp4');
  assert.equal(c('part'), 'application/octet-stream'); // 临时文件不按音频处理
  assert.equal(c(''), 'application/octet-stream');
});

test('parseRangeHeader：区间 / 后缀 / 越界 / 语法错误', () => {
  const p = pure.parseRangeHeader;
  assert.deepEqual(p('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(p('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(p('bytes=-100', 1000), { start: 900, end: 999 }); // 后缀区间
  assert.deepEqual(p('bytes=-5000', 1000), { start: 0, end: 999 });   // 后缀超总量 → 全量
  assert.equal(p('bytes=1000-', 1000), 'invalid');  // start 越界 → 416
  assert.equal(p('bytes=99-0', 1000), 'invalid');    // end < start
  assert.equal(p('bytes=abc', 1000), 'invalid');
  assert.equal(p('chunks=0-1', 1000), 'invalid');
  assert.equal(p('', 1000), null);  // 无 Range → 200 全量
  assert.equal(p(undefined, 1000), null);
});

test('scanLibrary：两层结构扫描 / 文件名解析 / 跳过非音频与隐藏文件', async () => {
  const root = await makeTmpRoot();
  await fsp.mkdir(path.join(root, '周杰伦'), { recursive: true });
  await fsp.mkdir(path.join(root, '邓紫棋'), { recursive: true });
  await fsp.mkdir(path.join(root, '周杰伦', '专辑'), { recursive: true }); // 三层：忽略
  await fsp.writeFile(path.join(root, '周杰伦', '晴天 - qq.mp3'), Buffer.alloc(64));
  await fsp.writeFile(path.join(root, '周杰伦', '七里香 - netease.flac'), Buffer.alloc(32));
  await fsp.writeFile(path.join(root, '周杰伦', '.晴天 - qq.mp3.part'), Buffer.alloc(8)); // 隐藏/临时
  await fsp.writeFile(path.join(root, '周杰伦', 'cover.txt'), 'x'); // 非音频
  await fsp.writeFile(path.join(root, '邓紫棋', '光年之外 - qq.wav'), Buffer.alloc(16));
  await fsp.writeFile(path.join(root, '直接放根目录.mp3'), Buffer.alloc(4)); // 根层：忽略

  const files = await pure.scanLibrary(root);
  assert.equal(files.length, 3);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  const sunny = byPath['周杰伦/晴天 - qq.mp3'];
  assert.ok(sunny);
  assert.equal(sunny.artist, '周杰伦');
  assert.equal(sunny.name, '晴天');
  assert.equal(sunny.fileName, '晴天 - qq.mp3');
  assert.equal(sunny.size, 64);
  assert.equal(typeof sunny.mtime, 'number');
  const light = byPath['邓紫棋/光年之外 - qq.wav'];
  assert.equal(light.name, '光年之外');
  assert.equal(light.size, 16);
  // 不存在的根目录 → 空列表（不抛）
  assert.deepEqual(await pure.scanLibrary(path.join(root, 'nope')), []);
  await fsp.rm(root, { recursive: true, force: true });
});

// ─── 路由集成（express 临时实例，127.0.0.1 随机端口）─────────────────────────

const requireFromServer = createRequire(new URL('../server/routes/', import.meta.url));
const express = requireFromServer('express');

function startApp(router, downloadRoot) {
  return new Promise((resolve) => {
    const app = express();
    app.use('/api/download', router);
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('library：返回 tasks（含 speed）与磁盘 files；running 任务置顶顺序', async () => {
  const root = await makeTmpRoot();
  await fsp.mkdir(path.join(root, '周杰伦'), { recursive: true });
  await fsp.writeFile(path.join(root, '周杰伦', '晴天 - qq.mp3'), Buffer.alloc(64));

  const runningTask = {
    id: 't1', status: 'running', phase: 'downloading',
    song: { source: 'qq', id: '1', name: '晴天', artist: '周杰伦' },
    received: 1024, total: 4096, percent: 25, size: 0,
    path: path.join(root, '周杰伦', '晴天 - qq.mp3'), error: '', existed: false,
    createdAt: Date.now(), finishedAt: 0, downloadStartedAt: Date.now() - 2000,
  };
  const doneTask = {
    id: 't0', status: 'done', phase: 'downloading',
    song: { source: 'qq', id: '0', name: '七里香', artist: '周杰伦' },
    received: 100, total: 100, percent: 100, size: 100,
    path: 'x', error: '', existed: false,
    createdAt: Date.now() - 60000, finishedAt: Date.now() - 30000, downloadStartedAt: 0,
  };
  const router = factory({ downloadRoot: root, taskManager: { list: () => [runningTask, doneTask] } });
  const { server, base } = await startApp(router, root);
  try {
    const res = await fetch(`${base}/api/download/library`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.tasks));
    assert.ok(Array.isArray(data.files));
    // 契约字段：任务 {id, song:{name,artist,source}, status, percent, speed, path, error}
    const t = data.tasks[0];
    for (const key of ['id', 'song', 'status', 'percent', 'speed', 'path', 'error']) {
      assert.ok(key in t, `tasks 缺字段 ${key}`);
    }
    assert.equal(t.song.name, '晴天');
    assert.equal(t.status, 'running');
    assert.ok(t.speed >= 0);
    assert.equal(data.tasks[1].status, 'done');
    assert.equal(data.tasks[1].speed, 0);
    // files 契约字段
    const f = data.files[0];
    for (const key of ['artist', 'name', 'fileName', 'path', 'size', 'mtime']) {
      assert.ok(key in f, `files 缺字段 ${key}`);
    }
    assert.equal(f.path, '周杰伦/晴天 - qq.mp3');
  } finally {
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('serve：Range 0-99 → 206 + Content-Range；无 Range → 200 全量', async () => {
  const root = await makeTmpRoot();
  await fsp.mkdir(path.join(root, '周杰伦'), { recursive: true });
  const body = Buffer.alloc(500);
  for (let i = 0; i < body.length; i++) body[i] = i % 256;
  await fsp.writeFile(path.join(root, '周杰伦', '晴天 - qq.mp3'), body);

  const router = factory({ downloadRoot: root, taskManager: null });
  const { server, base } = await startApp(router, root);
  try {
    const rel = encodeURIComponent('周杰伦/晴天 - qq.mp3');
    // Range 0-99 → 206
    const r1 = await fetch(`${base}/api/download/serve?path=${rel}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(r1.status, 206);
    assert.equal(r1.headers.get('content-range'), 'bytes 0-99/500');
    assert.equal(r1.headers.get('content-length'), '100');
    assert.equal(r1.headers.get('accept-ranges'), 'bytes');
    assert.ok(r1.headers.get('content-type').startsWith('audio/'));
    const chunk = Buffer.from(await r1.arrayBuffer());
    assert.equal(chunk.length, 100);
    assert.equal(chunk[0], 0);
    assert.equal(chunk[99], 99);
    // 无 Range → 200 全量
    const r2 = await fetch(`${base}/api/download/serve?path=${rel}`);
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('content-length'), '500');
    const full = Buffer.from(await r2.arrayBuffer());
    assert.equal(full.length, 500);
    // ETag 协商 → 304
    const etag = r2.headers.get('etag');
    assert.ok(etag);
    const r3 = await fetch(`${base}/api/download/serve?path=${rel}`, { headers: { 'If-None-Match': etag } });
    assert.equal(r3.status, 304);
    // 越界 Range → 416 + Content-Range: bytes */500
    const r4 = await fetch(`${base}/api/download/serve?path=${rel}`, { headers: { Range: 'bytes=999-' } });
    assert.equal(r4.status, 416);
    assert.equal(r4.headers.get('content-range'), 'bytes */500');
    // 越界后缀区间合法（-1000 → 0-499）
    const r5 = await fetch(`${base}/api/download/serve?path=${rel}`, { headers: { Range: 'bytes=-1000' } });
    assert.equal(r5.status, 206);
    assert.equal(r5.headers.get('content-range'), 'bytes 0-499/500');
  } finally {
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('serve 防穿越：../、绝对路径、不存在文件分别 400 / 400 / 404', async () => {
  const root = await makeTmpRoot();
  await fsp.mkdir(path.join(root, '周杰伦'), { recursive: true });
  await fsp.writeFile(path.join(root, '周杰伦', '晴天 - qq.mp3'), Buffer.alloc(8));
  // 逃逸目标真实存在（下载根之外），用于验证 ../ 被路径层面拒绝
  const outside = path.join(os.tmpdir(), `mei-dl-outside-${Date.now()}`);
  await fsp.mkdir(outside, { recursive: true });
  await fsp.writeFile(path.join(outside, 'secret.mp3'), Buffer.alloc(8));

  const router = factory({ downloadRoot: root, taskManager: null });
  const { server, base } = await startApp(router, root);
  try {
    const r1 = await fetch(`${base}/api/download/serve?path=${encodeURIComponent('../../etc/passwd')}`);
    assert.equal(r1.status, 400);
    const r2 = await fetch(`${base}/api/download/serve?path=${encodeURIComponent('/etc/passwd')}`);
    assert.equal(r2.status, 400);
    // 穿到下载根之外的同盘真实文件（相对形式）
    const relOutside = path.relative(root, path.join(outside, 'secret.mp3'));
    const r3 = await fetch(`${base}/api/download/serve?path=${encodeURIComponent(relOutside)}`);
    assert.equal(r3.status, 400);
    const r4 = await fetch(`${base}/api/download/serve?path=${encodeURIComponent('周杰伦/不存在 - qq.mp3')}`);
    assert.equal(r4.status, 404);
    const r5 = await fetch(`${base}/api/download/serve`);
    assert.equal(r5.status, 400);
  } finally {
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test('DELETE：删除文件 + 空歌手目录清理；穿越 / 绝对路径 / 不存在分别 400 / 400 / 404', async () => {
  const root = await makeTmpRoot();
  await fsp.mkdir(path.join(root, '周杰伦'), { recursive: true });
  await fsp.mkdir(path.join(root, '邓紫棋'), { recursive: true });
  await fsp.writeFile(path.join(root, '周杰伦', '晴天 - qq.mp3'), Buffer.alloc(8));
  await fsp.writeFile(path.join(root, '邓紫棋', '光年之外 - qq.wav'), Buffer.alloc(8));
  await fsp.writeFile(path.join(root, '邓紫棋', '泡沫 - netease.flac'), Buffer.alloc(8));

  const router = factory({ downloadRoot: root, taskManager: null });
  const { server, base } = await startApp(router, root);
  try {
    // 删除唯一文件的歌手目录 → 目录一并清理
    const r1 = await fetch(`${base}/api/download/library?path=${encodeURIComponent('周杰伦/晴天 - qq.mp3')}`, { method: 'DELETE' });
    assert.equal(r1.status, 200);
    assert.deepEqual(await r1.json(), { removed: true });
    assert.equal(await fsp.stat(path.join(root, '周杰伦')).catch(() => 'gone'), 'gone');
    // 多文件的歌手目录保留
    const r2 = await fetch(`${base}/api/download/library?path=${encodeURIComponent('邓紫棋/泡沫 - netease.flac')}`, { method: 'DELETE' });
    assert.equal(r2.status, 200);
    assert.equal((await fsp.stat(path.join(root, '邓紫棋'))).isDirectory(), true);
    assert.equal(fs.readdirSync(path.join(root, '邓紫棋')).length, 1);
    // 防穿越
    const r3 = await fetch(`${base}/api/download/library?path=${encodeURIComponent('../../etc/passwd')}`, { method: 'DELETE' });
    assert.equal(r3.status, 400);
    const r4 = await fetch(`${base}/api/download/library?path=${encodeURIComponent('/etc/passwd')}`, { method: 'DELETE' });
    assert.equal(r4.status, 400);
    const r5 = await fetch(`${base}/api/download/library?path=${encodeURIComponent('周杰伦/不存在.mp3')}`, { method: 'DELETE' });
    assert.equal(r5.status, 404);
  } finally {
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// ─── 前端分发（不发真网）─────────────────────────────────────────────────────

test('resolvePlayUrl：source=server-local 直接返回 serve 直链（不 fetch 不走 providers）', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.fetch = async () => { throw new Error('server-local 分支不应发起任何请求'); };
  try {
    const api = await import('../js/mei/api.js');
    const rel = '周杰伦/晴天 - qq.mp3';
    const url = await api.resolvePlayUrl({ id: `file:${rel}`, source: 'server-local', name: '晴天', artist: '周杰伦' });
    assert.equal(url, `/api/download/serve?path=${encodeURIComponent(rel)}`);
    // 纯构造函数与歌曲条目
    const file = { path: rel, name: '晴天', artist: '周杰伦', fileName: '晴天 - qq.mp3', size: 1, mtime: 2 };
    const song = api.serverLocalSong(file);
    assert.equal(song.id, `file:${rel}`);
    assert.equal(song.source, 'server-local');
    assert.equal(api.sourceLabel('server-local'), '已下载');
    // 缺 name 时从路径末段解析歌名（去扩展名 + 去 " - 源" 后缀）
    const bare = api.serverLocalSong({ path: 'a/b.mp3' });
    assert.equal(bare.name, 'b');
    const withSource = api.serverLocalSong({ path: '周杰伦/晴天 - qq.mp3' });
    assert.equal(withSource.name, '晴天');
  } finally {
    delete globalThis.fetch;
    delete globalThis.localStorage;
  }
});

test('openMediaDownloads：iframe 内 postMessage 给外壳；独立访问降级 location.assign', async () => {
  const posted = [];
  const assigned = [];
  const fakeParent = {
    postMessage: (msg, origin) => posted.push({ msg, origin }),
  };
  globalThis.window = {
    location: { origin: 'https://mei.example' },
  };
  globalThis.location = { assign: (p) => assigned.push(p) };
  try {
    const api = await import('../js/mei/api.js');
    // 1) parent !== self → postMessage（客户端路由，禁止改 location）
    globalThis.window.parent = fakeParent;
    api.openMediaDownloads();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].msg.source, 'mei-iframe');
    assert.equal(posted[0].msg.type, 'navigate');
    assert.equal(posted[0].msg.path, '/downloads?type=music');
    assert.equal(posted[0].origin, 'https://mei.example');
    assert.equal(assigned.length, 0);
    // 2) parent === self → 降级 location.assign
    globalThis.window.parent = globalThis.window;
    api.openMediaDownloads();
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0], '/downloads?type=music');
  } finally {
    delete globalThis.window;
    delete globalThis.location;
  }
});

test('server-local 条目在 store 体系天然去重（file:<路径> 唯一键）', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  try {
    const { serverLocalSong } = await import('../js/mei/api.js');
    const { songKey } = await import('../js/mei/store.js');
    const a = serverLocalSong({ path: '周杰伦/晴天 - qq.mp3', name: '晴天', artist: '周杰伦' });
    const b = serverLocalSong({ path: '周杰伦/晴天 - qq.mp3', name: '晴天', artist: '周杰伦' });
    const c = serverLocalSong({ path: '周杰伦/晴天 - netease.mp3', name: '晴天', artist: '周杰伦' });
    assert.equal(songKey(a), songKey(b));       // 同文件 = 同一首
    assert.notEqual(songKey(a), songKey(c));    // 跨源同名文件 = 不同条目
  } finally {
    delete globalThis.localStorage;
  }
});
