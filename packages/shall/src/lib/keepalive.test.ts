import assert from 'node:assert/strict';
import test from 'node:test';

import { pickEvictionVictim } from './keepalive.ts';

const frame = (appId: string) => ({ appId, src: `/x?app=${appId}` });

test('prefetch-only apps are evicted before any visited app', () => {
  // solara 已访问（正在后台放音乐），tv/draw/tools 只是预热挂载
  const candidates = [frame('solara'), frame('tv'), frame('draw'), frame('tools'), frame('disks')];
  const victim = pickEvictionVictim(candidates, 'disks', ['solara']);
  // 被淘汰的必须是纯预热应用，而不是最久未动的 solara
  assert.ok(victim);
  assert.ok(['tv', 'draw', 'tools'].includes(victim));
  assert.notEqual(victim, 'solara');
});

test('falls back to LRU among visited apps when none are prefetch-only', () => {
  const candidates = [frame('solara'), frame('tv'), frame('draw'), frame('tools')];
  const victim = pickEvictionVictim(candidates, 'tools', ['solara', 'tv', 'draw', 'tools']);
  assert.equal(victim, 'solara');
});

test('never evicts the current app', () => {
  const candidates = [frame('solara'), frame('tv')];
  assert.equal(pickEvictionVictim(candidates, 'solara', ['solara', 'tv']), 'tv');
  assert.equal(pickEvictionVictim(candidates, 'tv', ['solara', 'tv']), 'solara');
});

test('returns null when only the current app is evictable', () => {
  assert.equal(pickEvictionVictim([frame('solara')], 'solara', ['solara']), null);
  assert.equal(pickEvictionVictim([frame('solara'), frame('tv')], 'solara', ['solara']), 'tv');
});
