import assert from 'node:assert/strict';
import test from 'node:test';

class FakeAudio {
  constructor() {
    this.paused = false;
    this.src = '';
    this.listeners = new Map();
  }
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }
  dispatchEvent(eventName) {
    this.listeners.get(eventName)?.forEach((fn) => fn());
  }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
}

test('switching songs stops the old audio immediately while the URL resolves', async () => {
  globalThis.Audio = FakeAudio;
  globalThis.fetch = async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return {
      ok: true,
      text: async () => JSON.stringify({ url: 'https://example.com/new-song.mp3' }),
    };
  };

  const { player } = await import('../js/mei/player.js');
  const { store } = await import('../js/mei/store.js');
  store.temp = [
    { id: 'old', name: 'Old song', artist: 'A', source: 'netease' },
    { id: 'new', name: 'New song', artist: 'B', source: 'netease' },
  ];

  player.init();
  player.setQueue('temp', 0);
  player.audio.src = 'https://example.com/old-song.mp3';
  player.audio.paused = false;

  const playing = player.playIndex(1);
  assert.equal(player.audio.paused, true);
  assert.equal(player.audio.src, '');

  await playing;
  assert.equal(player.audio.src, 'https://example.com/new-song.mp3');
  assert.equal(player.audio.paused, false);
});

test('audio errors automatically advance to the next song', async () => {
  globalThis.Audio = FakeAudio;
  const urls = ['https://example.com/bad.mp3', 'https://example.com/good.mp3'];
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ url: urls.shift() }),
  });

  const { player } = await import('../js/mei/player.js');
  const { store } = await import('../js/mei/store.js');
  store.temp = [
    { id: 'bad', name: 'Bad song', artist: 'A', source: 'netease' },
    { id: 'good', name: 'Good song', artist: 'B', source: 'netease' },
  ];

  player.init();
  player.setQueue('temp', 0);
  await player.playIndex(0);
  player.audio.dispatchEvent('error');
  await new Promise(resolve => setTimeout(resolve, 350));

  assert.equal(player.index, 1);
  assert.equal(player.audio.src, 'https://example.com/good.mp3');
});

test('zero-duration audio is treated as a playback failure and skipped', async () => {
  globalThis.Audio = FakeAudio;
  const urls = ['https://example.com/empty.mp3', 'https://example.com/next.mp3'];
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ url: urls.shift() }),
  });

  const { player } = await import('../js/mei/player.js');
  const { store } = await import('../js/mei/store.js');
  store.temp = [
    { id: 'empty', name: 'Empty song', artist: 'A', source: 'netease' },
    { id: 'next', name: 'Next song', artist: 'B', source: 'netease' },
  ];

  player.init();
  player.setQueue('temp', 0);
  await player.playIndex(0);
  player.audio.duration = 0;
  player.audio.dispatchEvent('loadedmetadata');
  await new Promise(resolve => setTimeout(resolve, 350));

  assert.equal(player.index, 1);
  assert.equal(player.audio.src, 'https://example.com/next.mp3');
});
