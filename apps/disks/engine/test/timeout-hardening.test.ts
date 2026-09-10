// 网盘搜索超时加固的确定性单元测试（不发真实网络请求）
// 覆盖：withDeadline 硬 deadline 语义（TG 部分返回/请求安全网的公共原语）、
// 插件在途单飞（请求风暴放大器的修复）。
// 注意：动态 import 前先设环境变量——关闭磁盘缓存（避免测试落盘 ./cache）、
// 缩短插件快窗（4s → 1s，让超时路径不必等 4 秒）。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { SearchPlugin, SearchResult } from '../src/types.ts';

process.env.CACHE_ENABLED = 'false';
process.env.ASYNC_RESPONSE_TIMEOUT = '1';

const { withDeadline } = await import('../src/http.ts');
const { runPluginSearch } = await import('../src/plugins/base.ts');
const { config } = await import('../src/config.ts');

// ---- withDeadline（TG 整体 deadline / 请求安全网的公共原语）----

test('withDeadline：promise 先决时返回其结果', async () => {
  const value = await withDeadline(Promise.resolve(42), 1000, () => -1);
  assert.equal(value, 42);
});

test('withDeadline：deadline 命中时返回兜底值（模拟慢源挂起）', async () => {
  const t0 = Date.now();
  const value = await withDeadline(new Promise<never>(() => {}), 50, () => 'partial');
  assert.equal(value, 'partial');
  assert.ok(Date.now() - t0 < 500, 'deadline 必须准点兜底，不受慢源影响');
});

test('withDeadline：promise 提前拒绝时异常正常传播', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('boom')), 1000, () => 'fallback'), /boom/);
});

test('withDeadline：超时分层常量满足由内向外递增', () => {
  // 引擎内层（频道 4s abort / 快窗 4s）必须全部小于 TG 整体 deadline，
  // TG deadline 必须小于请求安全网，安全网必须小于消费端（前端 10s / shell 8s）
  assert.ok(config.asyncResponseTimeoutSeconds * 1000 <= config.tgDeadlineMs);
  assert.ok(config.tgDeadlineMs < config.searchHardDeadlineMs);
  assert.ok(config.searchHardDeadlineMs < 8000, '安全网必须小于 shell DisksProvider 的 8s');
});

// ---- 插件在途单飞（runPluginSearch）----

function fakePlugin(name: string, search: SearchPlugin['search']): SearchPlugin {
  return { name, priority: 1, skipServiceFilter: false, search };
}

test('runPluginSearch 同键单飞：并发请求只触发一次外发抓取', async () => {
  let calls = 0;
  const plugin = fakePlugin('fake-flight', async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 60));
    return [{ unique_id: 'fake-flight-1', channel: '', title: 't', content: '', datetime: '', links: [] }] as SearchResult;
  });
  // 两个并发请求（不同主缓存键，模拟 SPA 多轮搜索 + shell 综合搜索同时命中）
  const [r1, r2] = await Promise.all([
    runPluginSearch(plugin, 'kw-single-flight', {}, 'main-a'),
    runPluginSearch(plugin, 'kw-single-flight', {}, 'main-b'),
  ]);
  assert.equal(calls, 1, '并发同键请求必须共享同一次外发抓取');
  assert.deepEqual(r1, r2);
});

test('runPluginSearch 快窗超时返回空，在途请求复用不再重复外发', async () => {
  assert.equal(config.asyncResponseTimeoutSeconds, 1); // 测试环境已缩短快窗
  let calls = 0;
  const plugin = fakePlugin('fake-hang', () => {
    calls++;
    return new Promise<SearchResult[]>(() => {}); // 模拟源站挂起：永不完成
  });
  // 第一次：快窗命中 → 返回空（此前会写入 complete:false 占位缓存）
  const r1 = await runPluginSearch(plugin, 'kw-hang', {}, 'main-hang-1');
  assert.equal(r1.length, 0);
  // 第二次（补全窗口内的重复请求）：在途单飞复用，不再重复外发
  const r2 = await runPluginSearch(plugin, 'kw-hang', {}, 'main-hang-2');
  assert.equal(r2.length, 0);
  assert.equal(calls, 1, '快窗超时后的重复请求不得再次触发全量插件抓取');
});
