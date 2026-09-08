import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUILTIN_SEARCH_ENGINES,
  MAX_SEARCH_ENGINES,
  buildEngineSearchUrl,
  normalizeEngineUrl,
  normalizeSearchEngines,
  resolveDefaultEngineId,
  resolveSearchEngines,
} from './search-engines.ts';

test('normalizeEngineUrl：已含 {q} 占位时原样保留', () => {
  assert.equal(normalizeEngineUrl('https://a.com/s?q={q}'), 'https://a.com/s?q={q}');
});

test('normalizeEngineUrl：缺 {q} 时追加到末尾（兼容 …?q= 与裸域名）', () => {
  assert.equal(normalizeEngineUrl('https://a.com/s?q='), 'https://a.com/s?q={q}');
  assert.equal(normalizeEngineUrl('https://a.com/'), 'https://a.com/{q}');
});

test('normalizeEngineUrl：空串返回空', () => {
  assert.equal(normalizeEngineUrl('   '), '');
});

test('buildEngineSearchUrl：{q} 替换为 urlencoded 关键词', () => {
  const engine = { id: 'x', name: 'X', url: 'https://a.com/s?q={q}' };
  assert.equal(buildEngineSearchUrl(engine, '海贼王'), 'https://a.com/s?q=%E6%B5%B7%E8%B4%BC%E7%8E%8B');
  assert.equal(buildEngineSearchUrl(engine, 'a b&c'), 'https://a.com/s?q=a%20b%26c');
});

test('buildEngineSearchUrl：模板中多个 {q} 全部替换并去除首尾空白', () => {
  const engine = { id: 'x', name: 'X', url: 'https://a.com/s?q={q}&o={q}' };
  assert.equal(buildEngineSearchUrl(engine, ' 火影 '), 'https://a.com/s?q=%E7%81%AB%E5%BD%B1&o=%E7%81%AB%E5%BD%B1');
});

test('normalizeSearchEngines：过滤缺名称与非 http(s) 链接的非法项', () => {
  const out = normalizeSearchEngines([
    { id: 'ok', name: '合法', url: 'https://a.com/?q={q}' },
    { id: 'no-name', name: '  ', url: 'https://b.com/?q={q}' },
    { id: 'bad-url', name: '坏链接', url: 'ftp://c.com/{q}' },
    null,
  ]);
  assert.deepEqual(out.map((e) => e.id), ['ok']);
});

test('normalizeSearchEngines：缺 {q} 的模板自动追加', () => {
  const out = normalizeSearchEngines([{ id: 'e1', name: '引擎', url: 'https://a.com/s?q=' }]);
  assert.equal(out[0].url, 'https://a.com/s?q={q}');
});

test('normalizeSearchEngines：超长列表截断，重复 id 去重保留先到者', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, name: `引擎${i}`, url: `https://${i}.com/?q={q}` }));
  const out = normalizeSearchEngines(many);
  assert.equal(out.length, MAX_SEARCH_ENGINES);
  const duped = normalizeSearchEngines([
    { id: 'dup', name: 'A', url: 'https://a.com/?q={q}' },
    { id: 'dup', name: 'B', url: 'https://b.com/?q={q}' },
  ]);
  assert.equal(duped.length, 2);
  assert.notEqual(duped[1].id, 'dup');
  assert.equal(duped[1].name, 'B');
});

test('normalizeSearchEngines：缺 id 时自动生成唯一 id', () => {
  const out = normalizeSearchEngines([{ name: '无名', url: 'https://a.com/?q={q}' }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].id.length > 0);
});

test('normalizeSearchEngines：内置 id 名称强制对齐种子（修正历史长名）', () => {
  const out = normalizeSearchEngines([
    { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
    { id: 'ce-1', name: '自定义长名称不会被覆盖', url: 'https://a.com/?q={q}' },
  ]);
  assert.equal(out[0].name, 'Duck');
  assert.equal(out[1].name, '自定义长名称不会被覆盖');
});

test('resolveSearchEngines：未配置 / 空列表 / 全非法时回落内置种子', () => {
  assert.deepEqual(resolveSearchEngines(undefined), BUILTIN_SEARCH_ENGINES);
  assert.deepEqual(resolveSearchEngines({ searchEngines: [] }), BUILTIN_SEARCH_ENGINES);
  assert.deepEqual(resolveSearchEngines({ searchEngines: [{ id: 'x', name: '', url: '' }] }), BUILTIN_SEARCH_ENGINES);
});

test('resolveSearchEngines：合法自定义列表原样使用', () => {
  const list = [{ id: 'ce', name: '自定义', url: 'https://ce.com/?q={q}' }];
  assert.deepEqual(resolveSearchEngines({ searchEngines: list }), list);
});

test('resolveDefaultEngineId：记录值有效则保留，否则回落第一个', () => {
  const engines = [
    { id: 'a', name: 'A', url: 'https://a.com/?q={q}' },
    { id: 'b', name: 'B', url: 'https://b.com/?q={q}' },
  ];
  assert.equal(resolveDefaultEngineId({ searchEngine: 'b' }, engines), 'b');
  assert.equal(resolveDefaultEngineId({ searchEngine: 'ghost' }, engines), 'a');
  assert.equal(resolveDefaultEngineId(undefined, engines), 'a');
});

test('内置种子覆盖原四引擎且 id 与历史取值兼容', () => {
  assert.deepEqual(BUILTIN_SEARCH_ENGINES.map((e) => e.id), ['bing', 'google', 'baidu', 'duckduckgo']);
});
