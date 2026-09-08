import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  HOME_SEARCH_MODE_KEY,
  HOME_SEARCH_SCOPE_KEY,
  SEARCH_SCOPES,
  homeSearchTarget,
  parseHomeSearchMode,
  parseHomeSearchScope,
} from './home-search.ts';

const portalPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../components/PortalClient.tsx',
);
const portal = fs.readFileSync(portalPath, 'utf8');

test('parseHomeSearchMode：all 命中综合模式', () => {
  assert.equal(parseHomeSearchMode('all'), 'all');
});

test('parseHomeSearchMode：web 与未知值回落网页模式', () => {
  assert.equal(parseHomeSearchMode('web'), 'web');
  assert.equal(parseHomeSearchMode('bogus'), 'web');
  assert.equal(parseHomeSearchMode(''), 'web');
});

test('parseHomeSearchMode：localStorage 缺值（null/undefined）默认网页模式', () => {
  assert.equal(parseHomeSearchMode(null), 'web');
  assert.equal(parseHomeSearchMode(undefined), 'web');
});

test('parseHomeSearchScope：合法范围原样返回，非法/缺值回落 all', () => {
  for (const s of SEARCH_SCOPES) {
    assert.equal(parseHomeSearchScope(s.id), s.id);
  }
  assert.equal(parseHomeSearchScope('bogus'), 'all');
  assert.equal(parseHomeSearchScope(null), 'all');
  assert.equal(parseHomeSearchScope(undefined), 'all');
});

test('SEARCH_SCOPES 覆盖顶栏搜索框的全部范围且首项为全部', () => {
  assert.deepEqual(SEARCH_SCOPES.map((s) => s.id), ['all', 'tv', 'music', 'disks', 'draw', 'tools', 'novels']);
  assert.equal(SEARCH_SCOPES[0].label, '全部');
});

test('homeSearchTarget：默认 scope=all，与顶栏搜索框提交的路径一致', () => {
  assert.equal(homeSearchTarget('海贼王'), '/search?q=%E6%B5%B7%E8%B4%BC%E7%8E%8B&scope=all');
});

test('homeSearchTarget：携带范围筛选且关键词按 urlencoded 编码', () => {
  assert.equal(homeSearchTarget('a b&c', 'tv'), '/search?q=a+b%26c&scope=tv');
});

test('首页搜索框：模式切换在输入框框内左侧，右侧控制在框内右缘', () => {
  const toggleIdx = portal.indexOf('aria-label="搜索模式"');
  const toggleBlock = portal.slice(toggleIdx, toggleIdx + 400);
  const rightIdx = portal.indexOf('aria-label="综合搜索筛选"');
  const inputIdx = portal.indexOf("placeholder={searchMode === 'all'");
  assert.ok(toggleIdx > 0 && inputIdx > 0 && rightIdx > 0);
  // 框内左侧：切换控件为绝对定位且锚定 left:8（与输入框同容器）
  assert.match(toggleBlock, /left: 8/);
  assert.doesNotMatch(toggleBlock, /flexShrink/);
  assert.ok(inputIdx < rightIdx, '右侧控制在输入框之后');
});

test('首页搜索框：右侧下拉为窄幅（maxWidth 72），综合/网页模式各自渲染', () => {
  assert.match(portal, /maxWidth: 72/);
  assert.match(portal, /aria-label="综合搜索筛选"/);
  assert.match(portal, /aria-label="搜索引擎"/);
  assert.match(portal, /value=\{searchScope\}/);
  assert.match(portal, /value=\{defaultEngineId\}/);
});

test('首页搜索框默认网页模式（不改变既有行为），综合模式 Enter 带范围跳 /search 聚合页', () => {
  assert.match(portal, /useState<HomeSearchMode>\('web'\)/);
  assert.match(portal, /if \(searchMode === 'all'\) \{\s*navigate\(homeSearchTarget\(q, searchScope\)\);/);
});

test('隐秘站点门禁命令优先于搜索模式处理', () => {
  const submit = portal.indexOf('function submitSearch');
  const gateIdx = portal.indexOf('q.match(GATE_CMD)', submit);
  const modeIdx = portal.indexOf("searchMode === 'all'", submit);
  assert.ok(gateIdx > 0 && modeIdx > gateIdx, 'gate command handled before search mode');
});

test('搜索模式/范围记忆与顶栏 scope 记忆互不覆盖', () => {
  assert.match(portal, /localStorage\.setItem\(HOME_SEARCH_MODE_KEY, mode\)/);
  assert.match(portal, /localStorage\.setItem\(HOME_SEARCH_SCOPE_KEY, scope\)/);
  assert.doesNotMatch(portal, /localStorage\.setItem\(['"]mei-search-scope/);
});

test('框内切换引擎即写回面板默认引擎字段', () => {
  assert.match(portal, /searchEngine: id \} \}, '已设为默认搜索引擎'\)/);
});
