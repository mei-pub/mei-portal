import assert from 'node:assert/strict';
import test from 'node:test';

function createStorage(sources) {
  return {
    getItem(key) {
      if (key === 'mei-music-sources') return JSON.stringify(sources);
      if (key === 'mei-youtube-source-migrated-v1') return '1';
      return null;
    },
    setItem() {},
  };
}

async function importApi(sources) {
  globalThis.localStorage = createStorage(sources);
  return import(`../js/mei/api.js?search=${Math.random().toString(36).slice(2)}`);
}

test('search aggregate can target one enabled source', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      text: async () => JSON.stringify([{ id: 'n1', name: 'Sunny', artist: ['Artist'] }]),
    };
  };

  const { searchAggregate } = await importApi(['netease', 'qq']);
  const results = await searchAggregate('Sunny', 20, null, { source: 'qq' });

  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('source=qq'));
  assert.deepEqual(results.map((song) => song.id), ['n1']);
});

test('search aggregate ignores a source outside enabled settings', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return { ok: true, text: async () => '[]' };
  };

  const { searchAggregate } = await importApi(['netease']);
  const results = await searchAggregate('keyword', 20, null, { source: 'qq' });

  assert.deepEqual(results, []);
  assert.equal(requests.length, 0);
});

test('search aggregate can request a later page from one source', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return { ok: true, text: async () => '[]' };
  };

  const { searchAggregate } = await importApi(['netease', 'qq']);
  await searchAggregate('keyword', 20, null, { source: 'qq', page: 2 });

  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('source=qq'));
  assert.ok(requests[0].includes('pages=2'));
});

test('search request guard marks only the latest request as current', async () => {
  const { createSearchRequestGuard } = await importApi(['netease']);
  const guard = createSearchRequestGuard();
  const first = guard.begin();
  const second = guard.begin();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test('search aggregate no longer filters by song or artist field', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify([
      { id: 'a1', name: 'Song A', artist: ['Jay Chou'] },
      { id: 'a2', name: 'Song B', artist: ['Someone Else'] },
    ]),
  });

  const { searchAggregate } = await importApi(['netease']);
  const results = await searchAggregate('jay chou', 20, null, { field: 'artist' });

  assert.deepEqual(results.map((song) => song.id), ['a1', 'a2']);
});
