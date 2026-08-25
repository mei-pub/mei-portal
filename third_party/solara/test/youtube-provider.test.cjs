const assert = require('node:assert/strict');
const test = require('node:test');

const { createYoutubeProvider } = require('../server/providers/youtube');

test('youtube search maps yt-dlp entries to the shared song model', async () => {
  const calls = [];
  const provider = createYoutubeProvider({
    runYtDlp: async (args) => {
      calls.push(args);
      return {
        entries: [{
          id: 'video-1',
          title: 'Example Song',
          channel: 'Example Artist',
          album: 'Example Album',
          thumbnail: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg',
          duration: 213,
        }],
      };
    },
  });

  const songs = await provider.search('example', 20, 1);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('ytsearch20:example'));
  assert.deepEqual(
    calls[0].slice(calls[0].indexOf('--js-runtimes'), calls[0].indexOf('--js-runtimes') + 2),
    ['--js-runtimes', 'node']
  );
  assert.deepEqual(songs, [{
    id: 'video-1',
    name: 'Example Song',
    artist: ['Example Artist'],
    album: 'Example Album',
    pic_id: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg',
    url_id: 'video-1',
    lyric_id: 'video-1',
    source: 'youtube',
    duration: 213,
  }]);
});

test('youtube url requests a playable audio-only format', async () => {
  let captured;
  const provider = createYoutubeProvider({
    runYtDlp: async (args) => {
      captured = args;
      return {
        url: 'https://rr1---sn.example.googlevideo.com/videoplayback?id=video-1',
        abr: 128,
        filesize: 1234,
        ext: 'webm',
      };
    },
  });

  const result = await provider.url('video-1');

  assert.ok(captured.includes('-f'));
  assert.ok(captured.some((arg) => arg.includes('bestaudio')));
  assert.ok(captured.includes('https://www.youtube.com/watch?v=video-1'));
  assert.equal(result.url, 'https://rr1---sn.example.googlevideo.com/videoplayback?id=video-1');
  assert.equal(result.br, 128);
  assert.equal(result.size, 1234);
  assert.equal(result.ext, 'webm');
});

test('youtube yt-dlp options include manual token override when configured', async () => {
  let captured;
  const provider = createYoutubeProvider({
    env: {
      YOUTUBE_PO_TOKEN: 'secret-token',
      YOUTUBE_VISITOR_DATA: 'visitor-data',
    },
    runYtDlp: async (args) => {
      captured = args;
      return { url: 'https://x.googlevideo.com/audio', abr: 128 };
    },
  });

  await provider.url('video-2');

  const extractorArgs = captured[captured.indexOf('--extractor-args') + 1];
  assert.match(extractorArgs, /po_token=mweb\.gvs\+secret-token/);
  assert.match(extractorArgs, /visitor_data=visitor-data/);
});

test('youtube lyric gracefully returns an empty lyric', async () => {
  const provider = createYoutubeProvider({ runYtDlp: async () => ({}) });
  assert.deepEqual(await provider.lyric('video-1'), { lrc: '' });
});
