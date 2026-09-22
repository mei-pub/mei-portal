// applyResultFilter 语义测试（对照 Go api/filter.go，无网络）
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResultFilter } from '../src/server.ts';
import type { MergedLink, SearchResponse, SearchResult } from '../src/types.ts';

function mergedLink(note: string): MergedLink {
  return { url: `https://pan.quark.cn/s/${note}`, password: '', note, datetime: '2026-01-01T00:00:00Z' };
}

function result(title: string, workTitles: string[]): SearchResult {
  return {
    message_id: '1',
    unique_id: `p-${title}`,
    channel: '',
    datetime: '2026-01-01T00:00:00Z',
    title,
    content: '',
    links: workTitles.map((w, i) => ({ type: 'quark', url: `u${i}`, password: '', work_title: w })),
  };
}

const mergedResponse: SearchResponse = {
  total: 3,
  merged_by_type: {
    quark: [mergedLink('阿凡达 4K'), mergedLink('阿凡达 合集')],
    baidu: [mergedLink('泰坦尼克 4K')],
  },
};

test('filter：exclude 任一命中即排除（Go some 语义，非 every）', () => {
  const filtered = applyResultFilter(mergedResponse, { exclude: ['合集', '泰坦尼克'] }, 'merged_by_type');
  // 「阿凡达 合集」含 exclude[0]、「泰坦尼克 4K」含 exclude[1]，各含其一即排除；
  // 「阿凡达 4K」不含任何 exclude 关键词，应保留
  assert.equal(filtered.total, 1);
  assert.equal(filtered.merged_by_type?.['quark']?.length, 1);
  assert.ok(filtered.merged_by_type?.['quark']?.[0]?.note.includes('4K'));
  assert.equal(filtered.merged_by_type?.['baidu'], undefined, '空分组应剔除');
});

test('filter：关键词大小写不敏感', () => {
  const filtered = applyResultFilter(mergedResponse, { exclude: ['4k'] }, 'merged_by_type');
  assert.equal(filtered.total, 1, '大写 4K 应被小写 exclude 命中并排除');
  assert.ok(filtered.merged_by_type?.['quark']?.[0]?.note.includes('合集'));
});

test('filter：include 至少命中一个；total 按过滤后重算', () => {
  const filtered = applyResultFilter(mergedResponse, { include: ['阿凡达'] }, 'merged_by_type');
  assert.equal(filtered.total, 2);
  assert.equal(Object.keys(filtered.merged_by_type ?? {}).length, 1);
});

test('filter：results 按 title 过滤、链接按 work_title 过滤、无链接结果剔除', () => {
  const response: SearchResponse = {
    total: 3,
    results: [
      result('阿凡达 合集', ['阿凡达 A', '其他作品 B']), // 一条链接不匹配 work_title
      result('阿凡达 单部', ['其他作品 C']), // 所有链接均不匹配
      result('别的资源', ['阿凡达 D']), // title 不匹配（即使 work_title 匹配）
    ],
  };
  const filtered = applyResultFilter(response, { include: ['阿凡达'] }, 'results');
  assert.equal(filtered.total, 1);
  assert.equal(filtered.results?.length, 1);
  assert.equal(filtered.results?.[0]?.links.length, 1, '不匹配的 work_title 链接应被剔除');
  assert.equal(filtered.results?.[0]?.links[0]?.work_title, '阿凡达 A');
});

test('filter：include/exclude 均为空时原样返回（不重建不丢字段）', () => {
  const filtered = applyResultFilter(mergedResponse, { include: [], exclude: [] }, 'merged_by_type');
  assert.equal(filtered, mergedResponse, '空过滤应原样返回同一对象');
  assert.equal(filtered.total, 3);
});

test('filter：results 内容 content 不参与过滤（Go 只看 title/work_title）', () => {
  const response: SearchResponse = {
    total: 1,
    results: [result('阿凡达', ['阿凡达 A'])],
  };
  // 旧实现会把 content 拼进过滤文本；这里 content 为空，构造一个 content 含关键词但 title 不含的场景
  const r = response.results![0]!;
  r.content = '泰坦尼克'; // content 含 exclude 关键词，但 title/work_title 不含
  const filtered = applyResultFilter({ ...response, results: [{ ...r }] }, { exclude: ['泰坦尼克'] }, 'results');
  assert.equal(filtered.total, 1, 'content 不应参与过滤（Go 语义）');
});
