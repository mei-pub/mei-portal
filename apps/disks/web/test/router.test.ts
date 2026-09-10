import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalPath, resolveRoute } from '../src/router.ts';

test('resolves resource paths under /disks', () => {
  assert.deepEqual(resolveRoute('/disks/', '?kw=abc'), {
    page: 'search',
    params: new URLSearchParams('?kw=abc'),
  });
  assert.equal(resolveRoute('/disks/settings', '').page, 'status');
  assert.equal(resolveRoute('/disks/api', '').page, 'docs');
  assert.equal(resolveRoute('/disks/accounts', '').page, 'accounts');
  assert.equal(resolveRoute('/disks/qqpd', '').page, 'qqpd');
});

test('keeps legacy ?view deep links working', () => {
  assert.equal(resolveRoute('/disks/', '?view=config').page, 'status');
  assert.equal(resolveRoute('/disks/', '?view=api').page, 'docs');
});

test('builds canonical page paths', () => {
  assert.equal(canonicalPath('search'), '/disks/search');
  assert.equal(canonicalPath('status'), '/disks/settings');
  assert.equal(canonicalPath('docs'), '/disks/api');
});
