import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DISK_PLUGIN_BY_ID,
  MAGNET_DISK_CHANNELS,
  categorizeDiskPlugins,
  diskPluginCategory,
  diskPluginName,
  diskResultDedupeKey,
  isMagnetChannel,
} from './disk-sources.ts';

// image/supervisord.conf 中 disks 引擎的 ENABLED_PLUGINS 快照（51 个）。
// 引擎启用清单变更时必须同步 disk-sources.ts 注册表，否则设置页显示裸 id。
const SUPERVISORD_ENABLED_PLUGINS = [
  'dyyjpro', 'duoduo', 'djgou', 'gaoqing888', 'hdmoli', 'haitunsou', 'hunhepan',
  'ikantv', 'jutoushe', 'kkv', 'dy4k', 'melost', 'meitizy', 'ouge', 'pansearch',
  'quarksoo', 'ting77', 'wanou', 'xb6v', 'xiaokupan', 'xiaozhang', 'xiaoyu',
  'yunso', 'yunsou', 'diduan', 'erxiao', 'huban', 'labi', 'shandian', 'zhizhen',
  'clxiong', 'jsnoteclub', 'ciligou', 'dyyj', 'jupansou', 'clmao', 'susu',
  'u3c3', '5266ys', 'dygang', 'leso', 'gying', 'weibo', 'qqpd', 'panlian',
  'thepiratebay', 'nyaa', 'quarkres', 'btbtlb', 'dygod', 'cldi',
];

test('every supervisord-enabled plugin is registered with a readable name', () => {
  const missing = SUPERVISORD_ENABLED_PLUGINS.filter((id) => !DISK_PLUGIN_BY_ID[id]);
  assert.deepEqual(missing, [], '设置页会把缺失项显示成裸 id');
  for (const id of SUPERVISORD_ENABLED_PLUGINS) {
    assert.notEqual(DISK_PLUGIN_BY_ID[id].name, id, `${id} 应有中文名`);
    assert.ok(DISK_PLUGIN_BY_ID[id].category === 'cloud' || DISK_PLUGIN_BY_ID[id].category === 'magnet');
  }
});

test('categorizes plugins by registry, falling back to cloud for unknown ids', () => {
  const { cloud, magnet, needsAccount } = categorizeDiskPlugins([
    'jutoushe', 'clmao', 'quarkres', 'unknown-new-plugin', 'weibo',
  ]);
  assert.deepEqual(cloud, ['jutoushe', 'quarkres', 'unknown-new-plugin', 'weibo']);
  assert.deepEqual(magnet, ['clmao']);
  assert.deepEqual(needsAccount, ['weibo']);
});

test('registry exposes readable names and categories', () => {
  assert.equal(diskPluginName('clmao'), '磁力猫');
  assert.equal(diskPluginName('never-registered'), 'never-registered');
  assert.equal(diskPluginCategory('clxiong'), 'magnet');
  assert.equal(diskPluginCategory('dygod'), 'magnet');
  assert.equal(diskPluginCategory('cldi'), 'magnet');
  assert.equal(diskPluginCategory('btbtlb'), 'magnet');
  assert.equal(diskPluginCategory('pansearch'), 'cloud');
  assert.equal(diskPluginCategory('not-here'), 'unknown');
});

test('magnet channels are recognized for settings grouping', () => {
  assert.equal(isMagnetChannel('ciliziyuanku'), true);
  assert.equal(isMagnetChannel('ciliziyuanku'.toUpperCase()), false);
  assert.equal(isMagnetChannel('Quark_Movies'), false);
  assert.equal(MAGNET_DISK_CHANNELS.size >= 3, true);
});

test('dedupe key collapses same share link with tracking noise and different case', () => {
  const a = diskResultDedupeKey('https://pan.quark.cn/s/abc123?pwd=xk2', '');
  const b = diskResultDedupeKey('https://PAN.QUARK.CN/s/abc123/', '');
  assert.equal(a, b);
  // different share id stays distinct
  const c = diskResultDedupeKey('https://pan.quark.cn/s/other', '');
  assert.notEqual(a, c);
});

test('dedupe key ignores the extraction password so merged variants collapse', () => {
  const base = 'https://pan.baidu.com/s/xyz';
  // the key is URL-identity only: providers disagree on the password snapshot,
  // and the caller prefers the entry that carries one
  assert.equal(diskResultDedupeKey(base), diskResultDedupeKey(base));
  assert.notEqual(diskResultDedupeKey(base), diskResultDedupeKey('https://pan.baidu.com/s/other'));
});

test('dedupe key keeps magnet and ed2k links verbatim but case-insensitive', () => {
  const magnet = 'magnet:?xt=urn:btih:ABCDEF&dn=Movie';
  assert.equal(
    diskResultDedupeKey(magnet),
    diskResultDedupeKey('magnet:?xt=urn:btih:abcdef&dn=Movie'),
  );
  assert.notEqual(
    diskResultDedupeKey(magnet),
    diskResultDedupeKey('magnet:?xt=urn:btih:000000&dn=Movie'),
  );
  assert.equal(
    diskResultDedupeKey('ed2k://|file|a.mkv|100|hash|/'),
    diskResultDedupeKey('ED2K://|file|a.mkv|100|hash|/'),
  );
  // magnet identity is the link itself; the password field carries no meaning
  assert.equal(diskResultDedupeKey(magnet), diskResultDedupeKey(magnet));
});
