import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, normalizeConfig, syncBuiltinItems } from './panel-store.ts';

const plugin = { id: 'lunatv', name: '影视门户', icon: 'lucide:tv', url: '/tv' };

test('updates legacy relative builtin URLs to the canonical plugin path', () => {
  const config = {
    ...DEFAULT_CONFIG,
    items: [
      {
        id: 'b-lunatv',
        groupId: 'builtin',
        title: '影视门户',
        description: '',
        url: '/lunatv',
        lanUrl: '',
        icon: 'lucide:tv',
        iconColor: '',
        builtin: 'lunatv',
      },
    ],
  };

  const result = syncBuiltinItems(config, [plugin]);
  assert.equal(result.changed, true);
  assert.equal(result.config.items[0].url, '/tv');
});

test('preserves custom builtin domains and lan URLs', () => {
  const config = {
    ...DEFAULT_CONFIG,
    items: [
      {
        id: 'b-lunatv',
        groupId: 'builtin',
        title: '影视门户',
        description: '',
        url: 'https://tv.example.com/tv',
        lanUrl: 'http://192.168.1.10:8080/tv',
        icon: 'lucide:tv',
        iconColor: '',
        builtin: 'lunatv',
      },
    ],
  };

  const result = syncBuiltinItems(config, [plugin]);
  assert.equal(result.config.items[0].url, 'https://tv.example.com/tv');
  assert.equal(result.config.items[0].lanUrl, 'http://192.168.1.10:8080/tv');
});

test('normalizeConfig keeps legacy config without custom engines on builtin defaults', () => {
  const config = normalizeConfig({ style: { searchEngine: 'google' } });
  assert.deepEqual(config.style.searchEngines, []);
  assert.equal(config.style.searchEngine, 'google');
});

test('normalizeConfig sanitizes managed engines and validates default id', () => {
  const config = normalizeConfig({
    style: {
      searchEngine: 'ce-1',
      searchEngines: [
        { id: 'ce-1', name: '聚合', url: 'https://s.example.com/search?q={q}' },
        { name: '坏引擎', url: 'ftp://x.com/{q}' },
        { id: 'ce-3', name: '尾部q', url: 'https://y.example.com/search?q=' },
      ],
    },
  });
  assert.equal(config.style.searchEngines.length, 2);
  assert.equal(config.style.searchEngines[0].id, 'ce-1');
  assert.equal(config.style.searchEngines[1].url, 'https://y.example.com/search?q={q}');
  assert.equal(config.style.searchEngine, 'ce-1');
});

test('normalizeConfig falls back to first engine when default id is unknown', () => {
  const config = normalizeConfig({
    style: {
      searchEngine: 'nope',
      searchEngines: [
        { id: 'a', name: '甲', url: 'https://a.example.com/?q={q}' },
        { id: 'b', name: '乙', url: 'https://b.example.com/?q={q}' },
      ],
    },
  });
  assert.equal(config.style.searchEngine, 'a');
});

test('内置卡片标题/描述跟随插件清单改名（应用名是系统级）', () => {
  const config = {
    ...DEFAULT_CONFIG,
    items: [
      {
        id: 'b-mediago',
        groupId: 'builtin',
        title: '媒体下载',
        description: '旧描述',
        url: '/media',
        lanUrl: '',
        icon: 'lucide:download',
        iconColor: '',
        builtin: 'mediago',
      },
      {
        id: 'custom-x',
        groupId: 'builtin',
        title: '我的自定义站',
        description: '自定义',
        url: 'https://example.com',
        lanUrl: '',
        icon: 'lucide:link',
        iconColor: '',
      },
    ],
  };
  const result = syncBuiltinItems(config, [
    { id: 'mediago', name: '下载中心', description: '统一下载管理', icon: 'lucide:download', url: '/media' },
  ]);
  // 内置卡片跟随清单
  assert.equal(result.config.items[0].title, '下载中心');
  assert.equal(result.config.items[0].description, '统一下载管理');
  // 自定义项标题不受影响
  assert.equal(result.config.items[1].title, '我的自定义站');
  assert.equal(result.changed, true);
});

test('标题与清单一致时不产生变更（幂等）', () => {
  const config = {
    ...DEFAULT_CONFIG,
    items: [
      {
        id: 'b-lunatv',
        groupId: 'builtin',
        title: '影视门户',
        description: '',
        url: '/tv',
        lanUrl: '',
        icon: 'lucide:tv',
        iconColor: '',
        builtin: 'lunatv',
      },
    ],
  };
  const result = syncBuiltinItems(config, [plugin]);
  assert.equal(result.changed, false);
});
