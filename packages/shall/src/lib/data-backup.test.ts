import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { buildBackupZip, restoreBackupZip } from './data-backup.ts';

function tempData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mei-backup-test-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('backup zip round-trips panel and browser data', () => {
  const root = tempData();
  fs.mkdirSync(path.join(root, 'shell'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'shell', 'panel.json'),
    JSON.stringify({
      style: { logoText: 'A' },
      groups: [{ id: 'g1', name: '一' }],
      items: [{ id: 'i1', title: 'x', url: 'u' }],
    }),
  );
  fs.writeFileSync(path.join(root, 'shell', 'user.json'), JSON.stringify({ uid: 'u1', username: 'admin' }));

  const zip = buildBackupZip({
    scopes: ['panel', 'pansou'],
    browserData: { panel: { 'mei-lan-mode': '1' }, pansou: { pansou_channels: '["a"]' } },
  });
  assert.ok(zip.length > 0);

  // 覆盖恢复
  fs.writeFileSync(
    path.join(root, 'shell', 'panel.json'),
    JSON.stringify({ style: { logoText: 'B' }, groups: [{ id: 'g9', name: '九' }], items: [] }),
  );
  const replace = restoreBackupZip(zip, 'replace');
  assert.equal(replace.ok, true);
  const panel = JSON.parse(fs.readFileSync(path.join(root, 'shell', 'panel.json'), 'utf8'));
  assert.equal(panel.style.logoText, 'A');
  assert.deepEqual(panel.groups.map((g: { id: string }) => g.id), ['g1']);
  assert.equal(replace.browserData.panel?.['mei-lan-mode'], '1');
});

test('merge restore keeps current-only panel data', () => {
  const root = tempData();
  fs.mkdirSync(path.join(root, 'shell'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'shell', 'panel.json'),
    JSON.stringify({
      style: { logoText: 'A' },
      groups: [{ id: 'g1', name: '一' }],
      items: [{ id: 'i1', title: 'x', url: 'u' }],
    }),
  );
  const zip = buildBackupZip({ scopes: ['panel'], browserData: {} });

  fs.writeFileSync(
    path.join(root, 'shell', 'panel.json'),
    JSON.stringify({
      style: { logoText: 'B' },
      groups: [
        { id: 'g1', name: '一' },
        { id: 'g2', name: '二' },
      ],
      items: [
        { id: 'i1', title: 'x', url: 'u' },
        { id: 'i2', title: 'y', url: 'v' },
      ],
    }),
  );
  restoreBackupZip(zip, 'merge');
  const panel = JSON.parse(fs.readFileSync(path.join(root, 'shell', 'panel.json'), 'utf8'));
  assert.equal(panel.style.logoText, 'A');
  assert.deepEqual(panel.groups.map((g: { id: string }) => g.id), ['g1', 'g2']);
  assert.deepEqual(panel.items.map((i: { id: string }) => i.id), ['i1', 'i2']);
});

test('merge restore dedupes music playlists by id and song', () => {
  const root = tempData();
  fs.mkdirSync(path.join(root, 'music'), { recursive: true });
  const db = new DatabaseSync(path.join(root, 'music', 'solara.db'));
  db.exec(`
    CREATE TABLE playback_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE favorites_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO playback_store (key, value, updated_at) VALUES (?, ?, ?)').run(
    'meiMusicPlaylists.v1',
    JSON.stringify([{ id: 'pl1', name: 'A', songs: [{ id: 's1', source: 'netease' }] }]),
    new Date().toISOString(),
  );
  db.close();

  const zip = buildBackupZip({ scopes: ['solara'], browserData: {} });
  const current = new DatabaseSync(path.join(root, 'music', 'solara.db'));
  current
    .prepare('UPDATE playback_store SET value = ? WHERE key = ?')
    .run(
      JSON.stringify([
        { id: 'pl1', name: 'A', songs: [{ id: 's2', source: 'netease' }] },
        { id: 'pl2', name: 'B', songs: [] },
      ]),
      'meiMusicPlaylists.v1',
    );
  current.close();

  restoreBackupZip(zip, 'merge');
  const merged = new DatabaseSync(path.join(root, 'music', 'solara.db'));
  const row = merged.prepare('SELECT value FROM playback_store WHERE key = ?').get('meiMusicPlaylists.v1');
  merged.close();
  const playlists = JSON.parse(String(row?.value)) as Array<{ id: string; songs: Array<{ id: string }> }>;
  assert.deepEqual(playlists.map((p) => p.id), ['pl1', 'pl2']);
  assert.deepEqual(playlists.find((p) => p.id === 'pl1')?.songs.map((s) => s.id), ['s2', 's1']);
});

test('merge restore keeps tunnel arrays as arrays', () => {
  const root = tempData();
  fs.mkdirSync(path.join(root, 'link'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'link', 'tunnels.json'),
    JSON.stringify([{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }]),
  );
  const zip = buildBackupZip({ scopes: ['mei-link'], browserData: {} });
  fs.writeFileSync(
    path.join(root, 'link', 'tunnels.json'),
    JSON.stringify([{ id: 't1', name: 'A', localPort: 1 }, { id: 't3', name: 'C' }]),
  );
  restoreBackupZip(zip, 'merge');
  const tunnels = JSON.parse(fs.readFileSync(path.join(root, 'link', 'tunnels.json'), 'utf8')) as Array<{
    id: string;
  }>;
  assert.deepEqual(tunnels.map((t) => t.id), ['t1', 't3', 't2']);
});
