// createLimiter 并发限制器测试（无网络；引擎中 searchTG/searchPlugins 的并发闸门）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/http.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('createLimiter：并发不超过上限', async () => {
  const lim = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const job = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(5);
    inFlight--;
    return inFlight;
  };
  const settled = await Promise.allSettled(Array.from({ length: 20 }, () => lim(job)));
  assert.equal(settled.length, 20);
  assert.ok(peak <= 3, `峰值并发 ${peak} 应不超过 3`);
  assert.ok(peak > 0);
});

test('createLimiter：FIFO 公平排队（先到先执行）', async () => {
  const lim = createLimiter(1);
  const order: string[] = [];
  const job = (name: string) => async () => {
    order.push(name);
    await sleep(1);
    return name;
  };
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => lim(job(n))));
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
});

test('createLimiter：任务拒绝后不丢唤醒，后续任务正常执行', async () => {
  const lim = createLimiter(1);
  const boom = () => Promise.reject(new Error('boom'));
  const ok = async () => 'ok';
  const p1 = lim(boom).then(
    () => 'unexpected',
    (e: Error) => `caught:${e.message}`,
  );
  const p2 = lim(ok);
  const p3 = lim(ok);
  const res = await Promise.all([p1, p2, p3]);
  assert.deepEqual(res, ['caught:boom', 'ok', 'ok']);
});

test('createLimiter：淘汰后释放的槽位能唤醒等待者（容量回归）', async () => {
  // 5 个任务 + 2 并发上限，全部应完成且峰值不超限
  const lim = createLimiter(2);
  let inFlight = 0;
  let peak = 0;
  const job = async (tag: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await sleep(5);
    inFlight--;
    return tag;
  };
  const res = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((t) => lim(() => job(t))),
  );
  assert.deepEqual(res, ['a', 'b', 'c', 'd', 'e']);
  assert.ok(peak <= 2, `峰值并发 ${peak} 应不超过 2`);
});
