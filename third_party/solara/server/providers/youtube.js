/**
 * YouTube experimental source.
 *
 * yt-dlp owns both search and stream extraction so metadata and playable URLs
 * use the same YouTube client/session. The BGUtil plugin supplies PO tokens.
 */

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PLAY_TIMEOUT = 30000;
const SEARCH_TIMEOUT = 12000;
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=';

function buildExtractorArgs(env) {
  const options = ['youtube:player_client=mweb'];
  if (env.YOUTUBE_PO_TOKEN) {
    options.push(`po_token=mweb.gvs+${env.YOUTUBE_PO_TOKEN}`);
  }
  if (env.YOUTUBE_VISITOR_DATA) {
    options.push(`visitor_data=${env.YOUTUBE_VISITOR_DATA}`);
  }
  return options.join(';');
}

async function defaultRunYtDlp(args, timeout = PLAY_TIMEOUT) {
  const { stdout } = await execFileAsync(
    process.env.YT_DLP_PATH || 'yt-dlp',
    args,
    {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }
  );
  return JSON.parse(stdout);
}

function bestThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  return thumbnails.length ? thumbnails[thumbnails.length - 1].url || '' : '';
}

function normalizeEntry(entry) {
  const id = String(entry.id || '');
  if (!id) return null;
  return {
    id,
    name: entry.title || '未知歌曲',
    artist: [entry.artist || entry.channel || entry.uploader || '未知歌手'],
    album: entry.album || '',
    pic_id: bestThumbnail(entry),
    url_id: id,
    lyric_id: id,
    source: 'youtube',
    duration: Number(entry.duration) || 0,
  };
}

function createYoutubeProvider(options = {}) {
  const env = options.env || process.env;
  const runner = options.runYtDlp || defaultRunYtDlp;
  const execute = (args, timeout) => runner([
    '--no-warnings',
    '--socket-timeout', '15',
    '--js-runtimes', 'node',
    '--extractor-args', buildExtractorArgs(env),
    ...args,
  ], timeout);

  return {
    async search(name, count = 20, page = 1) {
      const limit = Math.max(1, Math.min(Number(count) || 20, 50));
      const pageNo = Math.max(1, Number(page) || 1);
      const total = limit * pageNo;
      const data = await execute([
        '--dump-single-json',
        '--flat-playlist',
        '--playlist-end', String(total),
        `ytsearch${total}:${String(name || '')}`,
      ], SEARCH_TIMEOUT);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      return entries
        .slice((pageNo - 1) * limit, pageNo * limit)
        .map(normalizeEntry)
        .filter(Boolean);
    },

    async url(id) {
      if (!/^[A-Za-z0-9_-]{6,32}$/.test(String(id))) {
        throw new Error('无效的 YouTube 视频 ID');
      }
      const data = await execute([
        '--dump-single-json',
        '--no-playlist',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        `${YOUTUBE_URL}${id}`,
      ], PLAY_TIMEOUT);
      if (!data || !/^https?:\/\//.test(String(data.url || ''))) {
        throw new Error('YouTube 播放地址获取失败');
      }
      return {
        url: String(data.url),
        br: Number(data.abr) || 0,
        size: Number(data.filesize || data.filesize_approx) || 0,
        ext: /^[a-z0-9]{1,8}$/i.test(String(data.ext || '')) ? String(data.ext) : 'm4a',
        headers: data.http_headers && typeof data.http_headers === 'object' ? data.http_headers : {},
      };
    },

    async lyric() {
      return { lrc: '' };
    },

    async pic(id) {
      return String(id || '');
    },
  };
}

module.exports = {
  buildExtractorArgs,
  createYoutubeProvider,
  ...createYoutubeProvider({ runYtDlp: defaultRunYtDlp }),
};
