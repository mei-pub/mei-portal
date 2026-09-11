// 下载方式设置项（js/mei/api.js）：localStorage 读写、默认值与非法值兜底
import assert from 'node:assert/strict';
import test from 'node:test';

test('getDownloadMode 默认 local，合法值可读写，非法值拒绝并兜底', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    const api = await import('../js/mei/api.js');
    assert.equal(api.getDownloadMode(), 'local');
    assert.equal(api.setDownloadMode('server'), true);
    assert.equal(api.getDownloadMode(), 'server');
    assert.equal(api.setDownloadMode('bogus'), false);
    assert.equal(api.getDownloadMode(), 'server'); // 非法写入被拒绝，原值保留
    store['mei-download-mode'] = 'ask';
    assert.equal(api.getDownloadMode(), 'ask');
    store['mei-download-mode'] = 'garbage';
    assert.equal(api.getDownloadMode(), 'local'); // 脏值兜底回默认
    assert.deepEqual([...api.DOWNLOAD_MODES], ['local', 'server', 'both', 'ask']);
  } finally {
    delete globalThis.localStorage;
  }
});
