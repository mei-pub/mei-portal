// 本地音乐源 provider 的直链校验与降级链行为（stub fetch，不依赖真实上游）
import assert from 'node:assert/strict';
import test from 'node:test';

function res({ status = 200, type = 'audio/mpeg', headers = {}, url = 'https://x/a.mp3', body = '' } = {}) {
  const h = new Map(Object.entries({ 'content-type': type, ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

test('probeAudioUrl accepts ranged audio response with sufficient total size', async () => {
  const { probeAudioUrl } = await import('../server/providers/verify.js');
  globalThis.fetch = async () =>
    res({
      status: 206,
      type: 'audio/mpeg',
      headers: { 'content-range': 'bytes 0-1/4195720' },
      url: 'https://kw-lw.kuwo.cn/a.mp3',
    });
  const probe = await probeAudioUrl('https://kw-lw.kuwo.cn/a.mp3');
  assert.ok(probe);
  assert.equal(probe.url, 'https://kw-lw.kuwo.cn/a.mp3');
  assert.equal(probe.total, 4195720);
});

test('probeAudioUrl rejects notice audio (~180KB) and html interstitials and 403', async () => {
  const { probeAudioUrl } = await import('../server/providers/verify.js');
  const cases = [
    res({ status: 206, headers: { 'content-range': 'bytes 0-1/181521' } }), // 版权提醒语音
    res({ type: 'text/html; charset=UTF-8' }), // 90svip 签名中转死链
    res({ status: 403, type: 'text/html' }), // CDN 防盗链
  ];
  let i = 0;
  globalThis.fetch = async () => cases[i++];
  for (const _ of cases) {
    assert.equal(await probeAudioUrl('https://x/a.mp3'), null);
  }
});

test('probeAudioUrl follows redirect and reports the final url', async () => {
  const { probeAudioUrl } = await import('../server/providers/verify.js');
  globalThis.fetch = async () =>
    res({
      status: 206,
      type: 'audio/mpeg',
      headers: { 'content-range': 'bytes 0-1/10357226' },
      url: 'https://aqqmusic.tc.qq.com/M800x.mp3',
    });
  const probe = await probeAudioUrl('https://music.90svip.cn/api.php?get=url&sign=1');
  assert.ok(probe);
  assert.equal(probe.url, 'https://aqqmusic.tc.qq.com/M800x.mp3');
});

test('kuwo url falls through notice audio to a real link (antiserver → mobi)', async () => {
  const calls = [];
  globalThis.fetch = async (target) => {
    calls.push(String(target));
    if (String(target).startsWith('http://antiserver.kuwo.cn/')) {
      return res({ type: 'text/plain', body: 'https://kw-bj.kuwo.cn/notice.mp3' });
    }
    if (String(target).startsWith('https://kw-bj.kuwo.cn/notice.mp3')) {
      return res({ status: 206, headers: { 'content-range': 'bytes 0-1/181521' } }); // 提醒语音
    }
    if (String(target).startsWith('https://mobi.kuwo.cn/')) {
      return res({
        body: JSON.stringify({
          code: 200,
          data: { url: 'https://kw-lw.kuwo.cn/real.mp3', bitrate: 'flac' },
        }),
      });
    }
    if (String(target).startsWith('https://kw-lw.kuwo.cn/real.mp3')) {
      return res({ status: 206, headers: { 'content-range': 'bytes 0-1/4195720' } });
    }
    throw new Error('unexpected ' + target);
  };
  const kuwo = await import('../server/providers/kuwo.js');
  const info = await kuwo.url('22856494');
  assert.equal(info.url, 'https://kw-lw.kuwo.cn/real.mp3');
  assert.equal(info.br, 'flac');
  assert.equal(info.size, 4195720);
});

test('qq url prefers 90svip full-quality link over vkeys trial', async () => {
  globalThis.fetch = async (target) => {
    if (String(target) === 'https://music.90svip.cn/') {
      return res({
        body: JSON.stringify({
          code: 200,
          data: [{ url: 'api.php?get=url&type=qq&id=1&sign=s&t=1' }],
        }),
      });
    }
    if (String(target).startsWith('https://music.90svip.cn/api.php')) {
      return res({
        status: 206,
        headers: { 'content-range': 'bytes 0-1/10357226' },
        url: 'https://aqqmusic.tc.qq.com/M800x.mp3',
      });
    }
    throw new Error('unexpected ' + target);
  };
  const qq = await import('../server/providers/qq.js');
  const info = await qq.url('001X0PDf0W4lBq');
  assert.equal(info.url, 'https://aqqmusic.tc.qq.com/M800x.mp3');
  assert.equal(info.br, '128');
});

test('kugou dead 90svip link falls through the resolver chain instead of "succeeding"', async () => {
  globalThis.fetch = async (target) => {
    if (String(target) === 'https://music.90svip.cn/') {
      return res({
        body: JSON.stringify({ code: 200, data: [{ url: 'api.php?get=url&type=kg&sign=dead' }] }),
      });
    }
    if (String(target).startsWith('https://music.90svip.cn/api.php')) {
      return res({ type: 'text/plain', url: 'https://music.90svip.cn/api.php?get=url&type=kg&sign=dead' });
    }
    if (String(target).startsWith('https://music-api2.cenguigui.cn/')) {
      return res({ body: JSON.stringify({ data: { url: 'https://fsandroid.kugou.com/ok.mp3' } }) });
    }
    if (String(target).startsWith('https://fsandroid.kugou.com/ok.mp3')) {
      return res({ status: 206, headers: { 'content-range': 'bytes 0-1/10792943' } });
    }
    throw new Error('unexpected ' + target);
  };
  const kugou = await import('../server/providers/kugou.js');
  const info = await kugou.url('BBFE9596615ADE83FF6B117831C45E4D');
  assert.equal(info.url, 'https://fsandroid.kugou.com/ok.mp3');
});
