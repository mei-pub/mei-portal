import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendEmbedParam,
  appCarrierHref,
  isAppPath,
  parseAppRoute,
  parseCarrierRoute,
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

test('appCarrierHref：应用路径包成 /app 承载地址', () => {
  const href = appCarrierHref('/music/search?q=abc#frag', plugins);
  assert.ok(href && href.startsWith('/app?'));
  const params = new URLSearchParams(href.slice(5));
  assert.equal(params.get('app'), 'solara');
  assert.equal(params.get('path'), '/music/search?q=abc#frag');
  // 应用根路径同样包裹
  assert.equal(appCarrierHref('/tv', plugins), '/app?app=lunatv&path=%2Ftv');
  // 非应用路径 / 外链 / 空路径 → null（调用方按原样跳转）
  assert.equal(appCarrierHref('/search?q=1', plugins), null);
  assert.equal(appCarrierHref('/settings', plugins), null);
  assert.equal(appCarrierHref('https://example.com/x', plugins), null);
  assert.equal(appCarrierHref('', plugins), null);
});

test('parseCarrierRoute：承载地址还原为应用路由（往返一致）', () => {
  const href = appCarrierHref('/tv/search?q=abc', plugins);
  const parsed = parseCarrierRoute('/app', href!.slice(5), plugins);
  assert.deepEqual(parsed, { appId: 'lunatv', path: '/tv/search?q=abc' });
  // 非承载路径 / 未知应用 / path 与 app 不匹配 / 缺参 → null
  assert.equal(parseCarrierRoute('/tv', '', plugins), null);
  assert.equal(parseCarrierRoute('/app', 'app=unknown&path=%2Ftv', plugins), null);
  assert.equal(parseCarrierRoute('/app', 'app=solara&path=%2Ftv%2Fx', plugins), null);
  assert.equal(parseCarrierRoute('/app', '', plugins), null);
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
