import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getPublicOrigin,
  normalizeBuiltinItemUrls,
  normalizeBuiltinUrl,
} from './navigation-url.ts';

test('derives the public origin from forwarded headers', () => {
  const origin = getPublicOrigin('allin.meichuanxue.cn:1080', 'https, http');
  assert.equal(origin?.origin, 'https://allin.meichuanxue.cn:1080');
});

test('rewrites legacy builtin URLs bound to the same host and port 7777', () => {
  const current = getPublicOrigin('allin.meichuanxue.cn:1080', 'http');
  assert.ok(current);
  assert.equal(
    normalizeBuiltinUrl('http://allin.meichuanxue.cn:7777/tv?from=home#play', current),
    '/tv?from=home#play'
  );
  assert.equal(normalizeBuiltinUrl('http://127.0.0.1:7777/music', current), '/music');
});

test('preserves explicit custom domains and same-host ports', () => {
  const current = getPublicOrigin('192.168.1.10:7777', 'http');
  assert.ok(current);
  assert.equal(normalizeBuiltinUrl('https://tv.example.com/tv', current), 'https://tv.example.com/tv');
  assert.equal(normalizeBuiltinUrl('http://192.168.1.10:8080/app', current), 'http://192.168.1.10:8080/app');
});

test('normalizes only builtin panel items', () => {
  const current = getPublicOrigin('allin.meichuanxue.cn:1080', 'http');
  assert.ok(current);
  const result = normalizeBuiltinItemUrls({
    items: [
      { builtin: 'lunatv', url: 'http://allin.meichuanxue.cn:7777/tv', lanUrl: 'http://192.168.1.10:8080/tv' },
      { url: 'http://allin.meichuanxue.cn:8080/custom', lanUrl: 'http://allin.meichuanxue.cn:9090/custom' },
    ],
  }, current);

  assert.equal(result.items[0].url, '/tv');
  assert.equal(result.items[0].lanUrl, 'http://192.168.1.10:8080/tv');
  assert.equal(result.items[1].url, 'http://allin.meichuanxue.cn:8080/custom');
  assert.equal(result.items[1].lanUrl, 'http://allin.meichuanxue.cn:9090/custom');
});
