import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  apiCacheSize,
  cachedFetchJson,
  clearApiCache,
} from './api-cache.ts';

test('cachedFetchJson：命中缓存时不再调用 loader', async () => {
  clearApiCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { ok: true };
  };
  const first = await cachedFetchJson('k1', 60_000, loader);
  const second = await cachedFetchJson('k1', 60_000, loader);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test('cachedFetchJson：TTL 过期后重新加载', async () => {
  clearApiCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };
  await cachedFetchJson('k2', 1, loader);
  await new Promise((r) => setTimeout(r, 10));
  const fresh = await cachedFetchJson('k2', 1, loader);
  assert.equal(fresh, 2);
  assert.equal(calls, 2);
});

test('cachedFetchJson：并发同 key 在途去重，只打一次上游', async () => {
  clearApiCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return 'payload';
  };
  const [a, b, c] = await Promise.all([
    cachedFetchJson('k3', 60_000, loader),
    cachedFetchJson('k3', 60_000, loader),
    cachedFetchJson('k3', 60_000, loader),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, 'payload');
  assert.equal(b, 'payload');
  assert.equal(c, 'payload');
});

test('cachedFetchJson：loader 抛错不缓存，下次重试', async () => {
  clearApiCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error('upstream down');
    return 'recovered';
  };
  await assert.rejects(() => cachedFetchJson('k4', 60_000, loader));
  const ok = await cachedFetchJson('k4', 60_000, loader);
  assert.equal(ok, 'recovered');
  assert.equal(calls, 2);
});

test('cachedFetchJson：超过容量上限时淘汰最旧条目', async () => {
  clearApiCache();
  let idx = 0;
  for (let i = 0; i < 310; i++) {
    idx = i;
    await cachedFetchJson(`cap-${idx}`, 60_000, async () => idx);
  }
  assert.ok(apiCacheSize() <= 300);
});
