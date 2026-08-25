import assert from 'node:assert/strict';
import test from 'node:test';

test('remote storage writes are serialized in call order', async () => {
  const completed = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.includes('status=1')) {
      return { ok: true, json: async () => ({ d1Available: true }) };
    }
    const body = JSON.parse(init.body);
    const first = body.data.first === '1';
    await new Promise(resolve => setTimeout(resolve, first ? 30 : 1));
    completed.push(body.data.first);
    return { ok: true, json: async () => ({}) };
  };

  const { remoteStorage } = await import('../js/mei/api.js');
  await Promise.all([
    remoteStorage.setItems({ first: '1' }),
    remoteStorage.setItems({ first: '2' }),
  ]);

  assert.deepEqual(completed, ['1', '2']);
});
