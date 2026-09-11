import assert from 'node:assert/strict';
import test from 'node:test';

test('wrapStreamUrl carries recommended YouTube headers through the proxy', async () => {
  const headers = {
    'User-Agent': 'Mozilla/5.0 Example',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-us,en;q=0.5',
    'Sec-Fetch-Mode': 'navigate',
  };

  const { wrapStreamUrl } = await import('../js/mei/api.js');
  const url = wrapStreamUrl('https://rr1---sn.example.googlevideo.com/audio?id=1', headers);
  const parsed = new URL(url, 'http://localhost');
  const decodedHeaders = JSON.parse(parsed.searchParams.get('headers'));

  assert.equal(parsed.pathname, '/proxy');
  assert.equal(parsed.searchParams.get('target'), 'https://rr1---sn.example.googlevideo.com/audio?id=1');
  assert.deepEqual(decodedHeaders, headers);
});

test('YouTube playback uses the short download proxy URL', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/download/library')) {
      // 本地已下载曲库预检（本地优先播放）：空库，youtube 分支不应有其他网络请求
      return { ok: true, json: async () => ({ tasks: [], files: [] }) };
    }
    return { ok: true, text: async () => JSON.stringify({ url: 'https://example.com/audio.m4a' }) };
  };

  const { resolvePlayUrl } = await import('../js/mei/api.js');
  const url = await resolvePlayUrl({ id: 'nuK3oi7-YoM', source: 'youtube' }, '320');
  const parsed = new URL(url, 'http://localhost');

  // 唯一 fetch 是本地库预检（youtube 分支本身零网络）
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].includes('api/download/library'));
  assert.equal(parsed.pathname, '/proxy');
  assert.equal(parsed.searchParams.get('types'), 'download');
  assert.equal(parsed.searchParams.get('source'), 'youtube');
  assert.equal(parsed.searchParams.get('id'), 'nuK3oi7-YoM');
});

test('resolvePlayUrl prefers the downloaded local file by name+artist (本地优先播放)', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/download/library')) {
      return {
        ok: true,
        json: async () => ({
          tasks: [],
          files: [
            { artist: '周杰伦', name: '晴天', fileName: '晴天 - qq.mp3', path: '周杰伦/晴天 - qq.mp3', size: 10, mtime: 1 },
          ],
        }),
      };
    }
    // 网络源解析若被意外触达（本地命中时不应发生）
    return { ok: true, text: async () => JSON.stringify({ url: 'https://example.com/net.mp3' }) };
  };

  const { resolvePlayUrl } = await import('../js/mei/api.js');
  const url = await resolvePlayUrl({ id: 'netease-1', name: '晴天', artist: '周杰伦', source: 'qq' }, '320');

  // 命中本地：直接返回 serve 流地址，且零网络源请求
  assert.ok(url.includes('api/download/serve'), `应返回 serve 地址，实际 ${url}`);
  assert.equal(new URLSearchParams(url.split('?')[1]).get('path'), '周杰伦/晴天 - qq.mp3');
  assert.ok(fetchCalls.every((u) => u.includes('api/download/library')), '不应触达网络源');
});

test('resolvePlayUrl falls through to network when local library has no match', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes('/api/download/library')) {
      return { ok: true, json: async () => ({ tasks: [], files: [] }) };
    }
    return { ok: true, text: async () => JSON.stringify({ url: 'https://example.com/net.mp3' }) };
  };

  const { resolvePlayUrl } = await import('../js/mei/api.js');
  const url = await resolvePlayUrl({ id: 'netease-2', name: '未下载的歌', artist: '某人', source: 'qq' }, '320');

  // 未命中本地（库里只有 晴天）→ 走网络源
  assert.ok(url.includes('example.com/net.mp3'), `未命中本地应走网络源，实际 ${url}`);
});
