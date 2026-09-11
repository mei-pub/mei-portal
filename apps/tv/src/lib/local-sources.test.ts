// 本地源模块确定性测试（node:test）：
// - 键 / 任务名 / 分类映射 / 状态映射（纯逻辑）
// - LocalSourceStore 读写 / 原子写 / 损坏容错（临时目录）

import assert from 'node:assert/strict';
import { existsSync,mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { LocalSourceRecord } from './local-source.types.ts';
import {
  downloadNameOf,
  LocalSourceStore,
  mapCategory,
  mapMediaStatus,
  mediaTaskTypeOf,
  normalizeTitle,
  recordKeyOf,
} from './local-sources.ts';

// ---------------------------------------------------------------------------
// 键与任务名
// ---------------------------------------------------------------------------

test('normalizeTitle：去空白 + 小写（中英文剧名空格差异归一）', () => {
  assert.equal(normalizeTitle('  The Last of Us '), 'thelastofus');
  assert.equal(normalizeTitle(' 流浪 地球 2 '), '流浪地球2');
  assert.equal(normalizeTitle(''), '');
});

test('recordKeyOf：同一剧同集幂等，不同年份/集数分离', () => {
  assert.equal(recordKeyOf('庆余年', '2019', 3), recordKeyOf(' 庆 余 年 ', '2019', 3));
  assert.notEqual(recordKeyOf('庆余年', '2019', 3), recordKeyOf('庆余年', '2024', 3));
  assert.notEqual(recordKeyOf('庆余年', '2019', 3), recordKeyOf('庆余年', '2019', 4));
});

test('downloadNameOf：电影用片名，剧集带 S01Exx', () => {
  assert.equal(downloadNameOf('流浪地球 2', 1, 1), '流浪地球 2');
  assert.equal(downloadNameOf('庆余年', 3, 46), '庆余年 S01E03');
});

// ---------------------------------------------------------------------------
// 分类映射
// ---------------------------------------------------------------------------

test('mapCategory：豆瓣 type 优先', () => {
  assert.equal(mapCategory({ doubanType: 'movie', className: '日本动漫' }), '电影');
  assert.equal(mapCategory({ doubanType: 'tv' }), '电视');
  assert.equal(mapCategory({ doubanType: 'anime' }), '动漫');
  assert.equal(mapCategory({ doubanType: 'show' }), '综艺');
});

test('mapCategory：CMS 分类字符串命中四目录', () => {
  assert.equal(mapCategory({ className: '日本动漫' }), '动漫');
  assert.equal(mapCategory({ className: '国产动漫' }), '动漫');
  assert.equal(mapCategory({ className: '大陆综艺' }), '综艺');
  assert.equal(mapCategory({ className: '真人秀' }), '综艺');
  assert.equal(mapCategory({ className: '纪录片' }), '电影'); // 以片结尾
  assert.equal(mapCategory({ className: '国产剧' }), '电视');
  assert.equal(mapCategory({ className: '韩剧' }), '电视');
});

test('mapCategory：未知归电视；单集兜底电影', () => {
  assert.equal(mapCategory({}), '电视');
  assert.equal(mapCategory({ totalEpisodes: 1 }), '电影');
  assert.equal(mapCategory({ totalEpisodes: 40 }), '电视');
  // 单集 + 无明确分类字符串的 CMS 分类 → 电影
  assert.equal(mapCategory({ className: '悬疑', totalEpisodes: 1 }), '电影');
});

// ---------------------------------------------------------------------------
// 状态与任务类型
// ---------------------------------------------------------------------------

test('mapMediaStatus：media 状态映射，未知返回 null', () => {
  assert.equal(mapMediaStatus('success'), 'done');
  assert.equal(mapMediaStatus('failed'), 'failed');
  assert.equal(mapMediaStatus('stopped'), 'failed');
  assert.equal(mapMediaStatus('downloading'), 'downloading');
  assert.equal(mapMediaStatus('pending'), 'pending');
  assert.equal(mapMediaStatus('ready'), null);
  assert.equal(mapMediaStatus('whatever'), null);
});

test('mediaTaskTypeOf：m3u8 链接走 N_m3u8DL-RE，其余走 aria2c', () => {
  assert.equal(mediaTaskTypeOf('https://x.com/a/index.m3u8'), 'm3u8');
  assert.equal(mediaTaskTypeOf('https://x.com/a/index.m3u8?token=1'), 'm3u8');
  assert.equal(mediaTaskTypeOf('https://x.com/a.mp4'), 'direct');
  assert.equal(mediaTaskTypeOf('https://x.com/video?id=1'), 'direct');
});

// ---------------------------------------------------------------------------
// 存储：读写 / 标题过滤 / 原子写 / 损坏容错
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord {
  const base: LocalSourceRecord = {
    key: recordKeyOf('测试剧', '2024', 1),
    title: '测试剧',
    year: '2024',
    episode: 1,
    totalEpisodes: 12,
    category: '电视',
    name: '测试剧 S01E01',
    mediaTaskId: 101,
    status: 'downloading',
    localUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

function tempStorePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mei-local-sources-'));
  return path.join(dir, 'local-sources.json');
}

test('LocalSourceStore：upsert/get/listByTitle/remove 全链路', async () => {
  const filePath = tempStorePath();
  try {
    const store = new LocalSourceStore(filePath);
    const r1 = makeRecord();
    const r2 = makeRecord({
      key: recordKeyOf('测试剧', '2024', 2),
      episode: 2,
      name: '测试剧 S01E02',
      mediaTaskId: 102,
    });
    const other = makeRecord({
      key: recordKeyOf('别的剧', '2024', 1),
      title: '别的剧',
      name: '别的剧 S01E01',
    });

    await store.upsert(r1);
    await store.upsert(r2);
    await store.upsert(other);

    const list = await store.listByTitle(' 测 试 剧 ', '2024');
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((r) => r.episode), [1, 2]);

    // 年份不匹配 → 过滤掉
    assert.equal((await store.listByTitle('测试剧', '1999')).length, 0);
    // 记录 year 为空串时视为通配
    await store.upsert(makeRecord({
      key: recordKeyOf('无年份剧', '', 1),
      title: '无年份剧',
      year: '',
    }));
    assert.equal((await store.listByTitle('无年份剧', '2024')).length, 1);

    assert.equal(await (await store.get(r1.key))?.mediaTaskId, 101);
    assert.equal(await store.get('missing'), null);

    assert.equal(await store.remove(r2.key), true);
    assert.equal(await store.remove(r2.key), false);
    assert.equal((await store.listByTitle('测试剧', '2024')).length, 1);
  } finally {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

test('LocalSourceStore：写入为合法 JSON 且无 tmp 残留（原子写）', async () => {
  const filePath = tempStorePath();
  try {
    const store = new LocalSourceStore(filePath);
    await store.upsert(makeRecord());
    // 直接读盘内容可解析
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    assert.equal(Object.keys(raw).length, 1);
    // tmp 文件被 rename 走，不残留
    assert.equal(existsSync(`${filePath}.tmp`), false);
  } finally {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

test('LocalSourceStore：损坏文件容错（改名隔离 + 重建空库）', async () => {
  const filePath = tempStorePath();
  try {
    writeFileSync(filePath, '{oops not json', 'utf8');
    const store = new LocalSourceStore(filePath);
    assert.equal((await store.listAll()).length, 0);
    // 坏文件被改名保留（不是被删除/覆盖）
    const dir = path.dirname(filePath);
    const corrupts = (await import('node:fs'))
      .readdirSync(dir)
      .filter((f) => f.startsWith('local-sources.json.corrupt-'));
    assert.equal(corrupts.length, 1);
    // 隔离后可继续写入
    await store.upsert(makeRecord());
    assert.equal((await store.listAll()).length, 1);
  } finally {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

test('LocalSourceStore：不同实例（模拟进程重启）重新从盘加载', async () => {
  const filePath = tempStorePath();
  try {
    const first = new LocalSourceStore(filePath);
    await first.upsert(makeRecord({ status: 'done', localUrl: '/videos/101' }));
    // 新实例（进程重启语义）读同一文件
    const second = new LocalSourceStore(filePath);
    const rec = await second.get(makeRecord().key);
    assert.equal(rec?.status, 'done');
    assert.equal(rec?.localUrl, '/videos/101');
  } finally {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});
