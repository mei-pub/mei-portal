// 本地源落盘文件管理测试（node:test，确定性）：
// - 纯逻辑：路径段清洗 / 删除路径构造与防穿越 / 集号模糊匹配 / 同剧末集目录判定
// - fs（临时目录）：该集文件删除（仅媒体扩展）/ 穿越记录拒绝执行 / 同剧末集清目录 / 大小统计

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { LocalSourceRecord } from './local-source.types.ts';
import {
  deletionPlanFor,
  episodeFilesSize,
  isMediaFile,
  listEpisodeFiles,
  matchesEpisodeFile,
  removeEpisodeFiles,
  removeSeriesDir,
  sanitizeSegment,
  seriesKeyPrefixOf,
  shouldRemoveSeriesDir,
} from './local-source-files.ts';
import { recordKeyOf } from './local-sources.ts';

function makeRecord(overrides: Partial<LocalSourceRecord> = {}): LocalSourceRecord {
  const title = '测试剧';
  const base: LocalSourceRecord = {
    key: recordKeyOf(title, '2024', 2),
    title,
    year: '2024',
    episode: 2,
    totalEpisodes: 12,
    category: '电视',
    name: '测试剧 S01E02',
    mediaTaskId: 101,
    status: 'done',
    localUrl: '/videos/101',
    playRoute: null,
    createdAt: 1,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// 纯逻辑：路径段清洗 / 防穿越
// ---------------------------------------------------------------------------

test('sanitizeSegment：空段 / 点段 / 分隔符 / 控制字符一律拒绝', () => {
  assert.equal(sanitizeSegment('电影'), '电影');
  assert.equal(sanitizeSegment(' 流浪地球 2 '), '流浪地球 2'); // 只去首尾空白
  assert.equal(sanitizeSegment(''), null);
  assert.equal(sanitizeSegment('   '), null);
  assert.equal(sanitizeSegment('.'), null);
  assert.equal(sanitizeSegment('..'), null);
  assert.equal(sanitizeSegment('a/b'), null);
  assert.equal(sanitizeSegment('..\\..'), null);
  assert.equal(sanitizeSegment('a\nb'), null);
  assert.equal(sanitizeSegment(undefined as unknown as string), null);
});

test('deletionPlanFor：正常记录构造 <root>/<分类>/<剧名> 目录', () => {
  const root = '/downloads/movie';
  const plan = deletionPlanFor(root, makeRecord());
  assert.ok(plan);
  assert.equal(
    plan!.seriesDir,
    path.resolve('/downloads/movie/电视/测试剧')
  );
});

test('deletionPlanFor：伪造 title=../../etc 的记录必须拒绝（防穿越）', () => {
  const root = '/downloads/movie';
  // key 与 title 均伪造为穿越路径
  const evil = makeRecord({
    key: recordKeyOf('../../etc', '2024', 1),
    title: '../../etc',
    category: '电影',
  });
  assert.equal(deletionPlanFor(root, evil), null);
  // 分类段穿越同样拒绝
  assert.equal(
    deletionPlanFor(root, makeRecord({ category: '../..' })),
    null
  );
  // 空分类 / 空剧名拒绝
  assert.equal(deletionPlanFor(root, makeRecord({ category: '' })), null);
  assert.equal(deletionPlanFor(root, makeRecord({ title: '  ' })), null);
  // 双保险：即便允许段内出现 ..（未来 sanitize 放宽），resolve 后越出 root 仍拒绝
  const sneaky = makeRecord({ title: 'a/../../..' });
  assert.equal(deletionPlanFor(root, sneaky), null);
});

// ---------------------------------------------------------------------------
// 纯逻辑：集号模糊匹配 / 同剧末集判定
// ---------------------------------------------------------------------------

test('isMediaFile：仅允许媒体扩展（排除 aria2 中间产物 / 文本）', () => {
  assert.equal(isMediaFile('测试剧 S01E02.mp4'), true);
  assert.equal(isMediaFile('测试剧 S01E02.MKV'), true);
  assert.equal(isMediaFile('movie.flv'), true);
  assert.equal(isMediaFile('movie.ts'), true);
  assert.equal(isMediaFile('测试剧 S01E02.aria2'), false);
  assert.equal(isMediaFile('测试剧 S01E02.mp4.aria2'), false);
  assert.equal(isMediaFile('readme.txt'), false);
  assert.equal(isMediaFile('noext'), false);
});

test('matchesEpisodeFile：集号模糊匹配（E2 命中 E02，不误命中 E12/E23）', () => {
  const ep2 = makeRecord({ episode: 2 });
  assert.equal(matchesEpisodeFile('测试剧 S01E02.mp4', ep2), true);
  assert.equal(matchesEpisodeFile('测试剧 S01E2.mp4', ep2), true); // padStart 差异容忍
  assert.equal(matchesEpisodeFile('测试剧 S01E02(1080P).mkv', ep2), true);
  assert.equal(matchesEpisodeFile('测试剧 S01E12.mp4', ep2), false);
  assert.equal(matchesEpisodeFile('测试剧 S01E23.mp4', ep2), false);
  assert.equal(matchesEpisodeFile('测试剧 S01E02.txt', ep2), false); // 非媒体扩展

  // 单集电影（totalEpisodes<=1）：目录内任意媒体文件即该“集”
  const movie = makeRecord({
    key: recordKeyOf('流浪地球 2', '2023', 1),
    title: '流浪地球 2',
    episode: 1,
    totalEpisodes: 1,
    category: '电影',
    name: '流浪地球 2',
  });
  assert.equal(matchesEpisodeFile('流浪地球 2.mp4', movie), true);
  assert.equal(matchesEpisodeFile('流浪地球 2(国语).mkv', movie), true);
  assert.equal(matchesEpisodeFile('流浪地球 2.aria2', movie), false);
});

test('seriesKeyPrefixOf + shouldRemoveSeriesDir：同剧末集目录清理判定', () => {
  const e2 = makeRecord(); // 测试剧|2024|e2
  assert.equal(seriesKeyPrefixOf(e2), '测试剧|2024|');

  // 同剧还有其他集 → 不清目录
  const sameSeries = [
    { key: recordKeyOf('测 试 剧', '2024', 1) },
    { key: recordKeyOf('测试剧', '2024', 3) },
  ];
  assert.equal(shouldRemoveSeriesDir(sameSeries, e2), false);

  // 同剧已无其他记录 → 清目录
  const others = [
    { key: recordKeyOf('测试剧', '2025', 1) }, // 同名不同年份：另一部
    { key: recordKeyOf('别的剧', '2024', 2) },
  ];
  assert.equal(shouldRemoveSeriesDir(others, e2), true);
  assert.equal(shouldRemoveSeriesDir([], e2), true);
});

// ---------------------------------------------------------------------------
// fs：该集文件删除 / 穿越拒绝 / 末集清目录 / 大小统计（临时目录）
// ---------------------------------------------------------------------------

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'mei-local-source-files-'));
}

function seedSeries(root: string): string {
  const dir = path.join(root, '电视', '测试剧');
  mkdirSync(dir, { recursive: true });
  const files = [
    '测试剧 S01E01.mp4',
    '测试剧 S01E02.mp4',
    '测试剧 S01E02.mp4.aria2', // 下载中间产物：不该被当成媒体文件
    '测试剧 S01E02.mkv', // 同集多封装：一并删除
    '测试剧 S01E12.flv',
    'note.txt',
  ];
  for (const f of files) {
    writeFileSync(path.join(dir, f), Buffer.alloc(16, 'x'));
  }
  writeFileSync(path.join(dir, '测试剧 S01E02.mp4'), Buffer.alloc(1024)); // 1KB
  return dir;
}

test('removeEpisodeFiles：删该集媒体文件（模糊匹配），不动其他集/非媒体', async () => {
  const root = tempRoot();
  try {
    seedSeries(root);
    const removed = await removeEpisodeFiles(root, makeRecord());
    assert.deepEqual([...removed].sort(), [
      '测试剧 S01E02.mkv',
      '测试剧 S01E02.mp4',
    ]);
    const dir = path.join(root, '电视', '测试剧');
    assert.equal(existsSync(path.join(dir, '测试剧 S01E01.mp4')), true);
    assert.equal(existsSync(path.join(dir, '测试剧 S01E12.flv')), true);
    assert.equal(
      existsSync(path.join(dir, '测试剧 S01E02.mp4.aria2')),
      true
    );
    assert.equal(existsSync(path.join(dir, 'note.txt')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removeEpisodeFiles / removeSeriesDir：伪造穿越记录拒绝执行（绝不越界）', async () => {
  const root = tempRoot();
  try {
    const victim = path.join(root, '绝不能删.txt');
    writeFileSync(victim, 'x');
    const evil = makeRecord({
      key: recordKeyOf('../../nope', '2024', 1),
      title: '../../nope',
      category: '电影',
    });
    await assert.rejects(() => removeEpisodeFiles(root, evil));
    await assert.rejects(() => removeSeriesDir(root, evil));
    await assert.rejects(() => listEpisodeFiles(root, evil));
    assert.equal(existsSync(victim), true); // 越界文件安然无恙
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removeSeriesDir：同剧末集删除后整个剧目录被清掉', async () => {
  const root = tempRoot();
  try {
    const dir = seedSeries(root);
    await removeSeriesDir(root, makeRecord());
    assert.equal(existsSync(dir), false);
    // 上级分类目录仍在（只删剧目录，不删分类目录）
    assert.equal(existsSync(path.join(root, '电视')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('episodeFilesSize / listEpisodeFiles：大小统计与列文件；目录缺失为空/null', async () => {
  const root = tempRoot();
  try {
    seedSeries(root);
    const rec = makeRecord();
    const files = await listEpisodeFiles(root, rec);
    assert.deepEqual([...files].sort(), [
      '测试剧 S01E02.mkv',
      '测试剧 S01E02.mp4',
    ]);
    // S01E02.mp4=1024B，mkv=16B
    assert.equal(await episodeFilesSize(root, rec), 1024 + 16);

    // 目录不存在的记录 → 列表为空、大小为 null
    const missing = makeRecord({ title: '不存在的剧' });
    assert.deepEqual(await listEpisodeFiles(root, missing), []);
    assert.equal(await episodeFilesSize(root, missing), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
