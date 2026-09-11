// 服务端下载（server/routes/server-download.js）纯逻辑与任务执行测试：
// 路径消毒 / 目标路径 / 扩展名推导 / 任务表状态机 / 直链解析降级 /
// runDownloadTask 全流程（mock providers + fetch，不发真实网络，落盘到临时目录）
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const factory = (await import('../server/routes/server-download.js')).default;

const CTRL = (code) => String.fromCharCode(code);

test('sanitizeSegment 剔除文件系统非法字符与控制字符并折叠空白', () => {
  const s = factory.sanitizeSegment;
  assert.equal(s('A/B\\C:D*E?F"G<H>I|J'), 'ABCDEFGHIJ');
  assert.equal(s('  多  空  格  '), '多 空 格');
  assert.equal(s('结尾点... '), '结尾点');
  assert.equal(s('a' + CTRL(0) + 'b' + CTRL(31) + 'c' + CTRL(127)), 'abc');
  assert.equal(s('', 'unknown'), 'unknown');
  assert.equal(s(null, '兜底'), '兜底');
  // 目录穿越：路径分隔被剔除，不可能逃出下载根目录
  assert.equal(s('../../etc/passwd'), '....etcpasswd');
  // 超长截断到 100
  assert.equal(s('x'.repeat(300)).length, 100);
});

test('buildTargetPath 结构：<root>/<歌手>/<歌名> - <source>.<ext>', () => {
  const b = factory.buildTargetPath;
  assert.equal(
    b('/downloads/music', { artist: '周杰伦', name: '晴天', source: 'qq' }),
    '/downloads/music/周杰伦/晴天 - qq.mp3'
  );
  assert.equal(
    b('/tmp/x', { artist: '', name: '', source: '' }, 'm4a'),
    '/tmp/x/未知歌手/未知歌曲 - unknown.m4a'
  );
  // 非法扩展名兜底 mp3
  assert.equal(
    b('/tmp/x', { artist: 'a', name: 'b', source: 'netease' }, '../evil'),
    '/tmp/x/a/b - netease.mp3'
  );
});

test('pickExt：provider ext 优先，Content-Type 映射次之，兜底 mp3', () => {
  const p = factory.pickExt;
  assert.equal(p({ ext: 'm4a' }, null), 'm4a');
  assert.equal(p({ ext: 'bad-ext!' }, { type: 'audio/mpeg' }), 'mp3');
  assert.equal(p({}, { type: 'audio/mpeg' }), 'mp3');
  assert.equal(p({}, { type: 'audio/flac; charset=utf-8' }), 'flac');
  assert.equal(p({}, { type: 'application/octet-stream' }), 'mp3');
  assert.equal(p(null, null), 'mp3');
});

test('任务表状态机：create → running、findRunning 去重、超限淘汰已完成', () => {
  const m = factory.createTaskManager(2);
  const song = { source: 'qq', id: '123', name: '晴天', artist: '周杰伦' };
  const t1 = m.create(song, '320');
  assert.equal(t1.status, 'running');
  assert.equal(t1.phase, 'resolving');
  assert.equal(m.get(t1.id), t1);
  assert.equal(m.get('nope'), null);
  // 同曲 running 复用
  assert.equal(m.findRunning(song), t1);
  assert.equal(m.findRunning({ source: 'qq', id: '456' }), null);
  // 完成后不再复用
  t1.status = 'done';
  assert.equal(m.findRunning(song), null);
  // 超限（2）：最早结束的任务先被淘汰（t1/t2），后结束的 t3 与 running 的 t4 保留
  const t2 = m.create({ source: 'a', id: '1' });
  t2.status = 'error';
  const t3 = m.create({ source: 'a', id: '2' });
  t3.status = 'done';
  const t4 = m.create({ source: 'a', id: '3' });
  assert.equal(m.get(t1.id), null);
  assert.equal(m.get(t2.id), null);
  assert.equal(m.get(t3.id), t3);
  assert.equal(m.get(t4.id), t4);
  assert.equal(m.count(), 2);
});

test('resolveUpstreamInfo：本地源音质降级（320 失败 → 192 成功）', async () => {
  const calls = [];
  const provider = {
    url: async (id, br) => {
      calls.push(br);
      if (br === '192') return { url: 'https://cdn/a.mp3', br, size: 100 };
      throw new Error(`br ${br} 不可用`);
    },
  };
  const info = await factory.resolveUpstreamInfo(
    { source: 'qq', id: '1' },
    '320',
    { getProvider: () => provider }
  );
  assert.equal(info.url, 'https://cdn/a.mp3');
  assert.deepEqual(calls, ['320', '192']);
});

test('resolveUpstreamInfo：本地源全部失败抛最后一个错误', async () => {
  const provider = { url: async () => { throw new Error('boom'); } };
  await assert.rejects(
    factory.resolveUpstreamInfo({ source: 'qq', id: '1' }, '320', { getProvider: () => provider }),
    /boom/
  );
});

test('resolveUpstreamInfo：无本地源回退 gdstudio 并按码率降级', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('br=320')) return { ok: false };
    return {
      ok: true,
      json: async () => ({ url: 'https://n/1.mp3', size: '4096' }),
    };
  };
  const info = await factory.resolveUpstreamInfo(
    { source: 'netease', id: '42' },
    '320',
    { getProvider: () => null, fetchImpl }
  );
  assert.equal(info.url, 'https://n/1.mp3');
  assert.equal(info.br, '192');
  assert.equal(info.size, 4096);
  assert.equal(calls.length, 2);
});

// ─── runDownloadTask 全流程（真实临时目录落盘，mock 网络）────────────────────

function makeTmpRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'mei-dl-test-'));
}

function webBuffer(size, fill) {
  return new Response(Buffer.alloc(size, fill));
}

test('runDownloadTask：流式落盘 → done，文件可读且大小一致', async () => {
  const root = await makeTmpRoot();
  const targetUrl = 'https://ws.stream.qq.com/a.mp3';
  const probe = async () => ({ url: targetUrl, total: 64, type: 'audio/mpeg' });
  const fetchCalls = [];
  const ctx = {
    downloadRoot: root,
    probeImpl: probe,
    resolveImpl: async () => ({ url: targetUrl }),
    fetchImpl: async (...args) => { fetchCalls.push(args); return webBuffer(64, 7); },
  };
  const manager = factory.createTaskManager();
  const task = manager.create({ source: 'qq', id: '1', name: '晴天', artist: '周杰伦' }, '320');

  await factory.runDownloadTask(task, ctx);

  assert.equal(task.status, 'done');
  assert.equal(task.existed, false);
  assert.equal(task.percent, 100);
  assert.equal(task.received, 64);
  const target = path.join(root, '周杰伦', '晴天 - qq.mp3');
  assert.equal(task.path, target);
  const stat = await fsp.stat(target);
  assert.equal(stat.size, 64);
  const buf = await fsp.readFile(target);
  assert.equal(buf[0], 7);
  // 临时文件已通过 rename 落盘，目录里不残留 .part 文件
  const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.part'));
  assert.deepEqual(leftovers, []);
  // 抓取头带 QQ 防盗链 Referer
  assert.equal(fetchCalls[0][1].headers.Referer, 'https://y.qq.com/');
  await fsp.rm(root, { recursive: true, force: true });
});

test('runDownloadTask：目标已存在且大小一致 → 直接返回已存在', async () => {
  const root = await makeTmpRoot();
  const target = path.join(root, '周杰伦', '晴天 - qq.mp3');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, Buffer.alloc(64, 9));

  let fetched = 0;
  const task = factory.createTaskManager().create(
    { source: 'qq', id: '1', name: '晴天', artist: '周杰伦' }, '320'
  );
  await factory.runDownloadTask(task, {
    downloadRoot: root,
    probeImpl: async () => ({ url: 'https://cdn.example/a.mp3', total: 64, type: 'audio/mpeg' }),
    resolveImpl: async () => ({ url: 'https://cdn.example/a.mp3' }),
    fetchImpl: async () => { fetched += 1; return webBuffer(64, 7); },
  });

  assert.equal(task.status, 'done');
  assert.equal(task.existed, true);
  assert.equal(task.path, target);
  assert.equal(fetched, 0); // 未重新下载
  assert.equal((await fsp.readFile(target))[0], 9); // 原文件未被覆盖
  await fsp.rm(root, { recursive: true, force: true });
});

test('runDownloadTask：直链校验失败 → error', async () => {
  const root = await makeTmpRoot();
  const task = factory.createTaskManager().create(
    { source: 'kugou', id: '1', name: 'x', artist: 'y' }, '320'
  );
  await factory.runDownloadTask(task, {
    downloadRoot: root,
    probeImpl: async () => null,
    resolveImpl: async () => ({ url: 'https://dead.example/a.mp3' }),
  });
  assert.equal(task.status, 'error');
  assert.match(task.error, /直链校验失败/);
  await fsp.rm(root, { recursive: true, force: true });
});

test('runDownloadTask：无数据看门狗超时 → error 并清理临时文件', async () => {
  const root = await makeTmpRoot();
  const task = factory.createTaskManager().create(
    { source: 'qq', id: '1', name: '晴天', artist: '周杰伦' }, '320'
  );
  const pendingStream = new Response(
    new ReadableStream({ start() { /* 永不下发数据 */ } })
  );
  await factory.runDownloadTask(task, {
    downloadRoot: root,
    idleTimeoutMs: 60,
    probeImpl: async () => ({ url: 'https://cdn.example/a.mp3', total: 4096, type: 'audio/mpeg' }),
    resolveImpl: async () => ({ url: 'https://cdn.example/a.mp3' }),
    fetchImpl: async () => pendingStream,
  });
  assert.equal(task.status, 'error');
  assert.match(task.error, /超时/);
  const dir = path.join(root, '周杰伦');
  const leftovers = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.deepEqual(leftovers, []);
  await fsp.rm(root, { recursive: true, force: true });
});
