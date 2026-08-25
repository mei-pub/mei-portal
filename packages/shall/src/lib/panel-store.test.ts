import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, syncBuiltinItems } from './panel-store.ts';

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
