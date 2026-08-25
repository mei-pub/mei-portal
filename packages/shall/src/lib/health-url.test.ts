import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHealthUrl } from './health-url.ts';

test('builds an absolute URL for single-image relative health paths', () => {
  assert.equal(
    buildHealthUrl('', '/tv', 'http://127.0.0.1:7777/api/health'),
    'http://127.0.0.1:7777/tv'
  );
});

test('preserves direct service endpoints used outside the single image', () => {
  assert.equal(
    buildHealthUrl('http://lunatv:3000', '/', 'http://127.0.0.1:7777/api/health'),
    'http://lunatv:3000/'
  );
});
