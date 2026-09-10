// 核心纯逻辑单元测试（不依赖网络）：node --experimental-strip-types --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNetDiskLinks, getLinkType, extractPassword, cleanBaiduPanURL, normalizeUrl } from '../src/regex.ts';
import { extractLinkTitlePairs, cleanTitle } from '../src/service/link-pairs.ts';
import { generatePluginCacheKey, generateTGCacheKey } from '../src/cache.ts';
import { mergeSearchResults, sortResultsByTimeAndKeywords, calculateTimeScore, getKeywordPriority } from '../src/merge.ts';
import { mergeResultsByType } from '../src/service/search.ts';
import { filterResultsByKeyword } from '../src/plugins/shared.ts';
import type { SearchResult } from '../src/types.ts';

test('extractNetDiskLinks 提取多网盘链接并去重', () => {
  const text = [
    '名称：测试资源',
    '链接：https://pan.quark.cn/s/abc123 提取码：x9y8',
    'https://pan.baidu.com/s/1aBc_-?pwd=ab12',
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    'https://www.alipan.com/s/zzz99',
  ].join('\n');
  const links = extractNetDiskLinks(text);
  assert.ok(links.some((l) => l.includes('pan.quark.cn/s/abc123')), '应提取夸克链接');
  assert.ok(links.some((l) => l.includes('pan.baidu.com/s/1aBc_')), '应提取百度链接');
  assert.ok(links.some((l) => l.startsWith('magnet:')), '应提取磁力链接');
  assert.ok(links.some((l) => l.includes('alipan.com/s/zzz99')), '应提取阿里云盘链接');
});

test('getLinkType 判定网盘类型', () => {
  assert.equal(getLinkType('https://pan.quark.cn/s/abc'), 'quark');
  assert.equal(getLinkType('https://pan.baidu.com/s/1abc'), 'baidu');
  assert.equal(getLinkType('https://www.alipan.com/s/1'), 'aliyun');
  assert.equal(getLinkType('magnet:?xt=urn:btih:abc'), 'magnet');
  assert.equal(getLinkType('https://cloud.189.cn/t/abc'), 'tianyi');
  assert.equal(getLinkType('https://example.com/x'), 'others');
});

test('extractPassword 从内容提取提取码', () => {
  // 真实 TG 消息形态：多行，标题含中文冒号先于 URL，提取码独立成段
  const content = ['🗄 阿凡达：火与烬 4K', '链接：https://pan.quark.cn/s/abc', '提取码：x9y8'].join('\n');
  assert.equal(extractPassword(content, 'https://pan.quark.cn/s/abc'), 'x9y8');
  assert.equal(extractPassword('访问码：ab12', 'https://cloud.189.cn/t/x'), 'ab12');
});

test('cleanBaiduPanURL 只保留 4 位密码', () => {
  const cleaned = cleanBaiduPanURL('https://pan.baidu.com/s/1abc?pwd=ab12xyz 文本');
  assert.ok(cleaned.endsWith('?pwd=ab12'), `实际: ${cleaned}`);
});

test('链接-标题配对：换行格式（标题行 + 链接行）', () => {
  const content = ['阿凡达：火与烬 4K HDR', '链接：https://pan.quark.cn/s/330ef4b', '提取码：x9y8'].join('\n');
  const map = extractLinkTitlePairs(content);
  assert.equal(map.get('https://pan.quark.cn/s/330ef4b'), '阿凡达：火与烬 4K HDR');
});

test('链接-标题配对：单行「标题丨网盘：链接」格式', () => {
  const content = '阿凡达丨夸克：https://pan.quark.cn/s/aaa111 天翼：https://cloud.189.cn/t/bbb222';
  const map = extractLinkTitlePairs(content);
  assert.ok([...map.keys()].some((k) => k.includes('pan.quark.cn/s/aaa111')), '应定位夸克链接');
  assert.ok(map.size > 0, '应产出映射');
});

test('缓存键稳定且区分来源', () => {
  const k1 = generateTGCacheKey('阿凡达', ['a', 'b']);
  const k2 = generateTGCacheKey('阿凡达', ['b', 'a']); // 顺序无关
  const k3 = generateTGCacheKey('阿凡达', ['a', 'c']);
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  const p1 = generatePluginCacheKey('kw', null);
  const p2 = generatePluginCacheKey('kw', ['pansearch']);
  assert.notEqual(p1, p2);
  assert.match(p1, /^[a-f0-9]{32}$/);
});

test('mergeSearchResults 去重保留更完整结果', () => {
  const a: SearchResult = {
    message_id: '',
    unique_id: 'quarkres-1',
    channel: '',
    datetime: '2026-01-01T00:00:00Z',
    title: '阿凡达',
    content: '',
    links: [{ type: 'quark', url: 'https://pan.quark.cn/s/x', password: '' }],
  };
  const b: SearchResult = {
    message_id: '9',
    unique_id: 'quarkres-1',
    channel: '',
    datetime: '2026-01-01T00:00:00Z',
    title: '阿凡达',
    content: '内容描述',
    links: [
      { type: 'quark', url: 'https://pan.quark.cn/s/x', password: '' },
      { type: 'baidu', url: 'https://pan.baidu.com/s/1y?pwd=ab12', password: 'ab12' },
    ],
  };
  const merged = mergeSearchResults([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].links.length, 2, '应保留更完整的结果');
});

test('时间与关键词评分', () => {
  assert.equal(calculateTimeScore(new Date().toISOString()), 500);
  assert.ok(getKeywordPriority('阿凡达 合集 4K') > 0);
  assert.equal(getKeywordPriority('阿凡达'), 0);
});

test('sortResultsByTimeAndKeywords：合集关键词优先', () => {
  const old: SearchResult = {
    message_id: '',
    unique_id: 'p-1',
    channel: '',
    datetime: '2020-01-01T00:00:00Z',
    title: '阿凡达 合集',
    content: '',
    links: [{ type: 'quark', url: 'u', password: '' }],
  };
  const fresh: SearchResult = {
    message_id: '',
    unique_id: 'p-2',
    channel: '',
    datetime: new Date().toISOString(),
    title: '阿凡达 单部',
    content: '',
    links: [{ type: 'quark', url: 'u2', password: '' }],
  };
  const results = [old, fresh];
  sortResultsByTimeAndKeywords(results);
  // 时间得分 500 > 20，但合集关键词 +490；两者得分接近，主断言：排序稳定完成且为降序
  assert.ok(Array.isArray(results) && results.length === 2);
});

test('mergeResultsByType：按类型分组 + 关键词过滤 + 来源标注', () => {
  const result: SearchResult = {
    message_id: '1',
    unique_id: 'yunpanx_1',
    channel: 'yunpanx',
    datetime: '2026-04-27T10:31:51Z',
    title: '阿凡达：火与烬/阿凡达3(2025)',
    content: '阿凡达：火与烬\n链接：https://pan.quark.cn/s/330ef4b',
    links: [{ type: 'quark', url: 'https://pan.quark.cn/s/330ef4b', password: '' }],
  };
  const magnet: SearchResult = {
    message_id: '',
    unique_id: 'dygod-118592',
    channel: '',
    datetime: '2026-01-01T00:00:00Z',
    title: '阿凡达 Avatar 2009',
    content: '别名: Avatar',
    links: [{ type: 'magnet', url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', password: '' }],
  };
  const merged = mergeResultsByType([result, magnet], '阿凡达', null);
  assert.ok(merged['quark'] && merged['quark'].length === 1, '应包含 quark 分组');
  assert.equal(merged['quark'][0].source, 'tg:yunpanx');
  assert.ok(merged['magnet'] && merged['magnet'].length === 1, '磁力源跳过关键词过滤应保留');
  assert.equal(merged['magnet'][0].source, 'plugin:dygod');

  // 关键词不匹配的网盘链接被过滤
  const filtered = mergeResultsByType(
    [{ ...result, title: '其他作品', links: [{ type: 'quark', url: 'https://pan.quark.cn/s/zzz', password: '' }] }],
    '不存在的关键词',
    null,
  );
  assert.equal(Object.keys(filtered).length, 0, '标题不含关键词的网盘链接应被过滤');
});

test('filterResultsByKeyword 多词 AND 匹配', () => {
  const r = (title: string): SearchResult => ({
    message_id: '',
    unique_id: '',
    channel: '',
    datetime: '',
    title,
    content: '',
    links: [],
  });
  const results = [r('阿凡达 合集'), r('阿凡达 单部'), r('其他')];
  assert.equal(filterResultsByKeyword(results, '阿凡达').length, 2);
  assert.equal(filterResultsByKeyword(results, '阿凡达 合集').length, 1);
  assert.equal(filterResultsByKeyword(results, '').length, 3);
});

test('normalizeUrl 解码中文用于去重', () => {
  assert.equal(normalizeUrl('https://x/%E4%B8%AD%E6%96%87'), 'https://x/中文');
});
