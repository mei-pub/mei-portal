import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSIC_BASE, canonicalUrl, resolveRoute } from '../js/mei/router.js';

test('resolves history routes below the /music mount', () => {
  assert.deepEqual(resolveRoute('/music/search', '?q=abc', ''), {
    path: '/search',
    params: new URLSearchParams('?q=abc'),
  });
  assert.deepEqual(resolveRoute('/music', '', ''), {
    path: '/search',
    params: new URLSearchParams(),
  });
});

test('legacy hash routes resolve to history paths', () => {
  assert.deepEqual(resolveRoute('/music', '', '#/player'), {
    path: '/player',
    params: new URLSearchParams(),
  });
});

test('builds canonical browser URLs with query parameters', () => {
  assert.equal(MUSIC_BASE, '/music');
  assert.equal(canonicalUrl('/search', new URLSearchParams({ q: 'abc' })), '/music/search?q=abc');
  assert.equal(canonicalUrl('/player'), '/music/player');
});
