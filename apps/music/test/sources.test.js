import assert from 'node:assert/strict';
import test from 'node:test';

function createStorage(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test('existing source settings receive YouTube once during migration', async () => {
  globalThis.localStorage = createStorage({
    'mei-music-sources': JSON.stringify(['netease', 'qq']),
  });
  const { enabledSources } = await import(`../js/mei/api.js?migration=${Date.now()}`);

  assert.deepEqual(enabledSources().map((source) => source.value), ['netease', 'qq', 'youtube']);

  localStorage.setItem('mei-music-sources', JSON.stringify(['netease', 'qq']));
  assert.deepEqual(enabledSources().map((source) => source.value), ['netease', 'qq']);
});

test('fresh source settings mark migration before the user disables YouTube', async () => {
  globalThis.localStorage = createStorage();
  const { enabledSources } = await import(`../js/mei/api.js?fresh=${Date.now()}`);

  assert.ok(enabledSources().some((source) => source.value === 'youtube'));
  assert.equal(localStorage.getItem('mei-youtube-source-migrated-v1'), '1');

  localStorage.setItem('mei-music-sources', JSON.stringify(['netease', 'qq']));
  assert.deepEqual(enabledSources().map((source) => source.value), ['netease', 'qq']);
});
