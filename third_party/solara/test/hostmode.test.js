// 宿主模式（被门户外壳以 iframe 承载）：播放控制必须委托给外壳，
// 应用内不得再创建/驱动本地 Audio，否则切换子应用时会出现双份播放。
import assert from 'node:assert/strict';
import test from 'node:test';

class FakeAudio {
  constructor() {
    this.paused = true;
    this.src = '';
    this.played = 0;
  }
  addEventListener() {}
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() {}
  play() { this.played++; this.paused = false; return Promise.resolve(); }
}

test('hosted player forwards controls instead of touching local audio', async () => {
  globalThis.Audio = FakeAudio;
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ url: 'https://x/a.mp3' }) });

  const { player } = await import('../js/mei/player.js');
  const { store } = await import('../js/mei/store.js');
  store.temp = [
    { id: 'a', name: 'A', artist: 'x', source: 'netease' },
    { id: 'b', name: 'B', artist: 'y', source: 'netease' },
  ];

  const sent = [];
  const host = { send: (msg) => sent.push(msg) };
  player.enableHostMode(host);
  assert.equal(player.isHosted(), true);

  player.setQueue('temp', 0);
  await player.playIndex(1);
  player.toggle();
  player.next();
  player.prev();
  player.seekTo(0.5);

  assert.deepEqual(
    sent.map((m) => m.type),
    ['set-queue', 'play-index', 'toggle', 'next', 'prev', 'seek']
  );
  assert.equal(sent[1].index, 1);
  assert.equal(sent[5].ratio, 0.5);
  // 本地音频镜像不应被真的驱动
  assert.equal(typeof player.audio.play, 'undefined');
});

test('hosted store delegates persistence to the shell instead of local storage', async () => {
  globalThis.Audio = FakeAudio;
  const { store } = await import('../js/mei/store.js');
  let pushed = 0;
  store.syncHook = () => { pushed++; };
  store.playlists = [{ id: 'pl1', name: 'L', songs: [] }];
  store.selectedPlaylistId = 'pl1';
  store.temp = [];
  store.favorites = [];

  store.addToPlaylist('pl1', { id: 'a', name: 'A', artist: 'x', source: 'netease' });
  store.toggleFavorite({ id: 'a', name: 'A', artist: 'x', source: 'netease' });
  store.addToTemp({ id: 'b', name: 'B', artist: 'y', source: 'netease' });

  assert.equal(pushed, 3);
  store.syncHook = null;
});
