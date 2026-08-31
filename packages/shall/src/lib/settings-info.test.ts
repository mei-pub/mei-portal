import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { SETTING_GROUPS } from './settings-entries.ts';
import { validateRemoteBackupConfig } from './remote-backup.ts';

test('settings sidebar uses unified groups, data backup and single help entry', () => {
  const apps = SETTING_GROUPS.find((g) => g.id === 'apps');
  const data = SETTING_GROUPS.find((g) => g.id === 'data');
  const runtime = SETTING_GROUPS.find((g) => g.id === 'runtime');
  const docs = SETTING_GROUPS.find((g) => g.id === 'docs');
  const system = SETTING_GROUPS.find((g) => g.id === 'system');

  assert.ok(apps && data && runtime && docs && system);
  assert.equal(docs?.entries.length, 1);
  assert.equal(docs?.entries[0]?.url, '/settings/help');
  assert.equal(apps?.entries.some((e) => e.id === 'novels-backup'), false);
  assert.equal(data?.entries[0]?.id, 'data-backup');
  assert.equal(data?.entries[0]?.url, '/settings/backup');
  assert.ok(runtime?.entries.some((e) => e.id === 'link-logs'));
  assert.ok(runtime?.entries.some((e) => e.id === 'draw-status'));
  assert.ok(runtime?.entries.every((e) => !e.url.startsWith('/link/')));
  assert.ok(
    apps?.entries
      .filter((e) => !e.id.startsWith('novels-'))
      .every((e) => e.url.startsWith('/settings/') || e.url.startsWith('/home-editor')),
  );
});

test('remote backup config validates target and credentials', () => {
  assert.equal(
    validateRemoteBackupConfig('webdav', { url: 'ftp://example.com/panel.json' })?.field,
    'url',
  );
  assert.equal(
    validateRemoteBackupConfig('s3', { endpoint: 'https://s3.example.com', bucket: '', key: 'backup.json' })?.field,
    'bucket',
  );
  assert.equal(
    validateRemoteBackupConfig('s3', {
      endpoint: 'https://s3.example.com',
      bucket: 'backups',
      key: 'panel.json',
      accessKey: '',
      secretKey: '',
    })?.field,
    'accessKey',
  );
  assert.equal(
    validateRemoteBackupConfig('webdav', { url: 'https://dav.example.com/backups/panel.json' }),
    undefined,
  );
  assert.equal(
    validateRemoteBackupConfig('s3', {
      endpoint: 'https://s3.example.com',
      bucket: 'backups',
      key: 'panel.json',
      accessKey: 'ak',
      secretKey: 'sk',
    }),
    undefined,
  );
});
