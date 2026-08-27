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
