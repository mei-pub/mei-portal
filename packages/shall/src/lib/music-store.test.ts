import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mei-music-store-'));
process.env.DATA_DIR = tmp;

const { getMusicState, patchMusicState, saveMusicState, normalizeState, DEFAULT_STATE } = await import(
  './music-store.ts'
);

const song = {
  id: '123',
  name: 'Song',
  artist: 'A',
  album: '',
  pic_id: 'p',
  lyric_id: '123',
  source: 'netease',
};

test('missing state file yields defaults without creating data', () => {
  const state = getMusicState('user1');
  assert.equal(state.revision, 0);
  assert.deepEqual(state.playlists, []);
});

test('patch merges nested sections and bumps revision', () => {
  const first = patchMusicState('user2', { favorites: [song] });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.state.revision, 1);

  const second = patchMusicState('user2', {
    revision: 1,
    playback: { position: 42 },
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  // 收藏未在本次 patch 中出现，必须保留
  assert.equal(second.state.favorites.length, 1);
  assert.equal(second.state.playback.position, 42);
  assert.equal(second.state.playback.mode, 'order');
  assert.equal(second.state.revision, 2);
});

test('stale revision is rejected as a conflict and keeps stored data', () => {
  patchMusicState('user3', { favorites: [song] });
  patchMusicState('user3', { revision: 1, favorites: [song, { ...song, id: '456' }] });
  const conflict = patchMusicState('user3', { revision: 0, favorites: [] });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false && conflict.conflict, true);
  assert.equal(getMusicState('user3').favorites.length, 2);
});

test('corrupted state surfaces an error instead of silently resetting', () => {
  const file = path.join(tmp, 'shell', 'music', 'user4.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => getMusicState('user4'));
});

test('normalizeState clamps and drops invalid entries', () => {
  const state = normalizeState({
    playlists: [{ id: 'pl1', name: 'L', songs: [song, { name: 'no id' }] }],
    queue: { type: 'bogus', index: -9 },
    playback: { mode: 'bogus', position: -5, volume: 9 },
    ui: { dockCollapsed: 'yes' },
  });
  assert.equal(state.playlists[0].songs.length, 1);
  assert.equal(state.queue.type, 'temp');
  assert.equal(state.queue.index, -1);
  assert.equal(state.playback.mode, 'order');
  assert.equal(state.playback.position, 0);
  assert.equal(state.playback.volume, 1);
  assert.equal(state.ui.dockCollapsed, false);
});

test('rejects unsafe account identifiers', () => {
  assert.throws(() => getMusicState('../escape'));
  assert.throws(() => saveMusicState('a/b', { ...DEFAULT_STATE }));
});
