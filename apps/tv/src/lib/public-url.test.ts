import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPublicProxyBase } from './public-url.ts';

test('builds the public proxy base from forwarded host and proto', () => {
  const headers = new Headers({
    host: '127.0.0.1:3000',
    'x-forwarded-host': 'allin.meichuanxue.cn:1080',
    'x-forwarded-proto': 'https, http',
  });

  assert.equal(
    getPublicProxyBase(headers, 'http://127.0.0.1:3000/api/proxy/m3u8'),
    'https://allin.meichuanxue.cn:1080/tv/api/proxy'
  );
});

test('falls back to request host and protocol when proxies are absent', () => {
  const headers = new Headers({ host: 'allin.meichuanxue.cn:1080' });

  assert.equal(
    getPublicProxyBase(headers, 'http://127.0.0.1:3000/api/proxy/m3u8'),
    'http://allin.meichuanxue.cn:1080/tv/api/proxy'
  );
});
