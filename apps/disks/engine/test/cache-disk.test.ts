// 两级缓存磁盘层测试（容错/容量/落盘，无网络；必须在 import 前设置环境变量）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SearchResult } from '../src/types.ts';

process.env['CACHE_ENABLED'] = 'true';
process.env['CACHE_PATH'] = mkdtempSync(join(tmpdir(), 'mei-engine-cache-'));
process.env['CACHE_MAX_SIZE'] = '1'; // 1MB，便于触发容量淘汰

const { cache, md5, TwoLevelCache } = await import('../src/cache.ts');

const cacheDir = process.env['CACHE_PATH']!;

function sampleResults(n: number): SearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    message_id: String(i),
    unique_id: `p-${i}`,
    channel: '',
    datetime: '2026-01-01T00:00:00Z',
    title: `结果${i}`,
    content: '',
    links: [{ type: 'quark', url: `https://pan.quark.cn/s/x${i}`, password: '' }],
  }));
}

function dirSize(): number {
  let total = 0;
  for (const f of readdirSync(cacheDir)) {
    try {
      total += statSync(join(cacheDir, f)).size;
    } catch {
      /* 忽略 */
    }
  }
  return total;
}

const HOUR = 60 * 60 * 1000;

test('磁盘层：set → shutdown 落盘 → 新实例可读回（内存不丢数据）', async () => {
  const key = 'disk-roundtrip-test-key';
  const results = sampleResults(2);
  const c1 = new TwoLevelCache();
  c1.set(key, results, HOUR);
  await c1.shutdown(); // 强制落盘（不等 2s 攒批）
  const c2 = new TwoLevelCache(); // 新实例：内存为空，只能从磁盘读
  const back = c2.get(key);
  assert.ok(back, '新实例应能从磁盘读回缓存');
  assert.equal(back!.length, 2);
  assert.equal(back![0]!.title, '结果0');
});

test('磁盘层：损坏的 JSON 缓存对被清理（get 返回 null 且文件删除）', async () => {
  const key = 'corrupt-key';
  const c1 = new TwoLevelCache();
  c1.set(key, sampleResults(1), HOUR);
  await c1.shutdown();
  const h = md5(key);
  const dataPath = join(cacheDir, `${h}.json`);
  const metaPath = join(cacheDir, `${h}.meta`);
  writeFileSync(dataPath, '{invalid json'); // 模拟半写/损坏
  const c2 = new TwoLevelCache();
  assert.equal(c2.get(key), null, '损坏缓存应返回 null');
  assert.equal(existsSync(dataPath), false, '损坏数据文件应被清理');
  assert.equal(existsSync(metaPath), false, '对应 meta 也应被清理');
  // 第二次 get 不再反复读损坏文件（已清理，仍返回 null）
  assert.equal(c2.get(key), null);
});

test('磁盘层：meta 孤立（data 缺失）被清理，不反复空跑', async () => {
  const key = 'orphan-meta-key';
  const h = md5(key);
  const metaPath = join(cacheDir, `${h}.meta`);
  writeFileSync(metaPath, JSON.stringify({ key, expiry: Date.now() + HOUR }));
  const c = new TwoLevelCache();
  assert.equal(c.get(key), null);
  assert.equal(existsSync(metaPath), false, '孤立 meta 应被清理');
});

test('磁盘层：容量淘汰统计包含 .json 数据文件（超限即删最旧）', async () => {
  // 8 条 × ~200KB ≈ 1.6MB > 1MB 上限；若只统计 meta（几百字节）则永远不会触发淘汰
  const c = new TwoLevelCache();
  const big = sampleResults(1).map((r) => ({ ...r, content: 'x'.repeat(200 * 1024) }));
  for (let i = 0; i < 8; i++) {
    c.set(`cap-key-${i}`, big, HOUR);
  }
  await c.shutdown(); // 触发 flush + enforceMaxSize
  const size = dirSize();
  assert.ok(size <= 1024 * 1024 + 64 * 1024, `磁盘占用 ${size}B 应被压回 ~1MB 上限（含 meta 松弛）`);
  assert.ok(size > 200 * 1024, `清理不应把全部缓存删光（实际 ${size}B）`);
});

test('磁盘层：shutdown 把 pending 攒批落盘（不丢写）', async () => {
  const key = 'pending-flush-key';
  cache.set(key, sampleResults(1), HOUR); // 单例：只入内存 + pending 队列
  await cache.shutdown(); // 立即落盘
  const h = md5(key);
  assert.ok(existsSync(join(cacheDir, `${h}.json`)), 'shutdown 后数据文件应存在');
  assert.ok(existsSync(join(cacheDir, `${h}.meta`)), 'shutdown 后 meta 文件应存在');
});
