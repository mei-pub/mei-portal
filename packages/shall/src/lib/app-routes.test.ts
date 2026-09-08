import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendEmbedParam,
  buildAppHref,
  isAppPath,
  legacyAppHostPath,
  normalizeAppPath,
  parseAppRoute,
  sameAppPath,
} from './app-routes.ts';

const plugins = [
  { id: 'lunatv', url: '/tv' },
  { id: 'solara', url: '/music' },
  { id: 'pansou', url: '/disks' },
  { id: 'tutorial', url: '/novels' },
];

test('matches app prefixes only at path boundaries', () => {
  assert.equal(isAppPath('/tv', plugins), true);
  assert.equal(isAppPath('/tv/search', plugins), true);
  assert.equal(isAppPath('/tvx', plugins), false);
  assert.equal(isAppPath('/search', plugins), false);
});

test('parses canonical app routes while preserving query and hash', () => {
  assert.deepEqual(parseAppRoute('/tv/search?q=%E6%B5%8B%E8%AF%95#frag', plugins), {
    appId: 'lunatv',
    path: '/tv/search?q=%E6%B5%8B%E8%AF%95#frag',
  });
  assert.equal(parseAppRoute('/tvx/search?q=1', plugins), null);
});

test('builds canonical hrefs without wrapping them in /app', () => {
  assert.equal(
    buildAppHref('/music/search?q=abc', plugins),
    '/music/search?q=abc'
  );
  assert.equal(buildAppHref('/disks?view=config', plugins), '/disks?view=config');
  assert.equal(buildAppHref('/unknown?q=1', plugins), null);
});

test('normalizes app roots but preserves meaningful trailing slashes', () => {
  assert.equal(normalizeAppPath('/tv/'), '/tv');
  assert.equal(normalizeAppPath('/tv/search/'), '/tv/search/');
});

test('converts the legacy /app host URL to a canonical path', () => {
  assert.equal(
    legacyAppHostPath('/app?app=lunatv&path=%2Ftv%2Fsearch%3Fq%3Dabc'),
    '/tv/search?q=abc'
  );
  assert.equal(
    legacyAppHostPath('/app?app=solara&path=%2Fmusic%23%2Fplayer'),
    '/music#/player'
  );
  assert.equal(legacyAppHostPath('/app?app=unknown&path=%2Funknown'), null);
});

test('appends meiEmbed while preserving query and hash', () => {
  assert.equal(
    appendEmbedParam('/tv/search?q=abc&meiEmbed=0#frag'),
    '/tv/search?q=abc&meiEmbed=1#frag'
  );
  assert.equal(appendEmbedParam('/music#/player'), '/music?meiEmbed=1#/player');
});

test('compares full app paths but ignores the embed marker', () => {
  assert.equal(sameAppPath('/tv/search?q=1', '/tv/search?q=1&meiEmbed=1'), true);
  assert.equal(sameAppPath('/tv/search?q=1', '/tv/search?q=2'), false);
  assert.equal(sameAppPath('/tv', '/tv/'), true);
});
