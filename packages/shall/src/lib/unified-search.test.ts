import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildDiskFacets,
  clampLimit,
  normalizeDiskResult,
  normalizeDrawResult,
  normalizeMusicResult,
  normalizeNovelResult,
  normalizeToolResult,
  normalizeVideoResult,
  parseSearchQuery,
  parseDiskType,
  parseDiskSourceFilters,
  providerEnabled,
  searchServerGroups,
  matchesVideoQuery,
  _setOmniToolsLocalesDir,
  _bindGetSessionTokens,
  _bindGetPortalToken,
  type SearchGroup,
} from './unified-search.ts';
import { appendSearchGroupPage } from './search-pagination.ts';

test('parses and validates search query parameters', () => {
  assert.deepEqual(parseSearchQuery(new URLSearchParams('?q=%20abc%20&scope=tv&limit=99')), {
    query: 'abc',
    scope: 'tv',
    limit: 50,
    offset: 0,
  });
  assert.equal(parseSearchQuery(new URLSearchParams('?q=abc&limit=0')).limit, 1);
  assert.equal(parseSearchQuery(new URLSearchParams('?q=abc&offset=40')).offset, 40);
  assert.equal(parseSearchQuery(new URLSearchParams('?q=abc&offset=-2')).offset, 0);
  assert.equal(parseSearchQuery(new URLSearchParams('?q=abc&scope=unknown')).scope, 'all');
});

test('filters video results by title relevance instead of trusting broad upstream matches', () => {
  assert.equal(matchesVideoQuery('BoA: Only One', 'boa'), true);
  assert.equal(matchesVideoQuery('投奔怒海', 'boa'), false);
  assert.equal(matchesVideoQuery('权力的游戏 第 1 季', '权力 游戏'), true);
});

test('normalizes application results into unified search results', () => {
  const video = normalizeVideoResult({
    id: 'v1',
    title: 'Movie',
    source: 'src',
    source_name: 'Source',
    year: 2024,
    poster: '/p.jpg',
  });
  assert.equal(video.kind, 'video');
  assert.equal(video.action.type, 'open');
  assert.equal(video.action.href, '/tv/play/src/v1');

  const song = normalizeMusicResult({ id: 's1', pic_id: 's1', name: 'Song', artist: 'Artist', source: 'netease' });
  assert.equal(song.kind, 'song');
  assert.equal(song.action.type, 'play');
  assert.equal(song.action.href, '/music/player');
  assert.equal(song.image, '/api/search/cover/netease/s1');

  const disk = normalizeDiskResult({
    url: 'https://example.com/a',
    note: 'Movie',
    datetime: '2026-01-01',
    source: 'quark',
  }, 'quark');
  assert.equal(disk.kind, 'diskLink');
  assert.equal(disk.action.type, 'external');
  assert.equal(disk.meta?.linkType, 'pan');
  assert.equal(disk.meta?.linkTypeLabel, '夸克网盘');
  assert.equal(disk.meta?.diskType, 'quark');
  assert.equal(disk.description, '2026-01-01');

  const branded = normalizeDiskResult({
    url: 'https://pan.quark.cn/s/abc',
    note: 'Quark resource',
    datetime: '0001-01-01T00:00:00Z',
    source: 'plugin:jutoushe',
  }, 'quark');
  assert.equal(branded.meta?.linkTypeLabel, '夸克网盘');
  assert.equal(branded.source?.name, '剧透社');
  assert.equal(branded.subtitle, '剧透社');
  assert.equal(branded.description, '');

  const hostFallback = normalizeDiskResult({
    url: 'https://pan.baidu.com/s/xyz',
    note: 'Baidu resource',
    source: 'plugin:unknownplugin',
  }, 'unknown');
  assert.equal(hostFallback.meta?.linkTypeLabel, '百度网盘');
  assert.equal(hostFallback.source?.name, 'unknownplugin');

  const magnet = normalizeDiskResult({
    url: 'magnet:?xt=urn:btih:ABC',
    note: 'Magnet resource',
    source: 'plugin:magnet',
  }, 'magnet');
  assert.equal(magnet.meta?.linkType, 'magnet');
  assert.equal(magnet.meta?.linkTypeLabel, '磁力链接');

  const ed2k = normalizeDiskResult({
    url: 'ed2k://|file|movie.mkv|1|ABC|/',
    note: 'ED2K resource',
    source: 'plugin:ed2k',
  }, 'ed2k');
  assert.equal(ed2k.meta?.linkType, 'ed2k');
  assert.equal(ed2k.meta?.linkTypeLabel, '电驴链接');

  const novel = normalizeNovelResult(
    { slug: 'book', title: 'Book', author: 'Author' },
    { slug: 'site', name: 'Site' }
  );
  assert.equal(novel.kind, 'novel');
  assert.equal(novel.action.href, '/novels/sites/site/books/book');

  const drawing = normalizeDrawResult({
    id: 'd1',
    title: 'My Drawing',
    engineType: 'gemini',
    thumbnail: '/thumb.png',
  });
  assert.equal(drawing.kind, 'drawing');
  assert.equal(drawing.appId, 'ai-draw');
  assert.equal(drawing.action.href, '/draw/editor/d1');

  const tool = normalizeToolResult('reverse', 'string', {
    title: '反转文本',
    description: '反转输入的文本',
    shortDescription: '快速反转',
  });
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.appId, 'omni-tools');
  assert.equal(tool.action.href, '/tools/string/reverse');
  assert.equal(tool.title, '反转文本');
});

test('selects providers by scope', () => {
  assert.equal(providerEnabled('all', 'tv'), true);
  assert.equal(providerEnabled('tv', 'tv'), true);
  assert.equal(providerEnabled('music', 'tv'), false);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(100), 50);
});

test('sanitizes disk type channel filters', () => {
  assert.equal(parseDiskType('quark'), 'quark');
  assert.equal(parseDiskType('  MAGNET '), 'magnet');
  assert.equal(parseDiskType('cloud_189'), 'cloud_189');
  assert.equal(parseDiskType(null), undefined);
  assert.equal(parseDiskType(''), undefined);
  assert.equal(parseDiskType('drop table;--'), undefined);
  assert.equal(parseDiskType('x'.repeat(40)), undefined);
});

test('parses disk source filters: absent keeps backend defaults, empty disables all', () => {
  // no params at all -> undefined (backend defaults)
  assert.equal(parseDiskSourceFilters(new URLSearchParams('?q=abc')), undefined);
  // explicit empty value -> user disabled every source in that dimension
  const disabled = parseDiskSourceFilters(new URLSearchParams('?plugins=&channels='));
  assert.deepEqual(disabled, { plugins: [], channels: [] });
  // concrete lists are sanitized against id patterns
  const filters = parseDiskSourceFilters(new URLSearchParams('?plugins=clmao,pansearch,bad id!&channels=Quark_Movies,tgsearchers6&cloud_types=quark,magnet'));
  assert.deepEqual(filters, {
    plugins: ['clmao', 'pansearch'],
    channels: ['Quark_Movies', 'tgsearchers6'],
    cloudTypes: ['quark', 'magnet'],
  });
});

test('DisksProvider forwards source filters and dedupes cross-source links', async () => {
  _bindGetSessionTokens(() => ({ 'ai-draw': 'test-token' }));
  const seenUrls: string[] = [];
  const fetchImpl = (async (url: string) => {
    if (url.includes('127.0.0.1:3008/api/search')) {
      seenUrls.push(url);
      return { ok: true, status: 200, json: async () => ({ data: { merged_by_type: {
        quark: [
          { url: 'https://pan.quark.cn/s/abc123?pwd=xk2', note: 'Same link A', source: 'plugin:jutoushe', password: 'xk2' },
          { url: 'https://PAN.QUARK.CN/s/abc123/', note: 'Same link A again', source: 'plugin:melost' },
          { url: 'https://pan.quark.cn/s/zzz999', note: 'Unique link B', source: 'plugin:melost' },
        ],
        baidu: [{ url: 'https://pan.baidu.com/s/b1', note: 'Baidu link', source: 'tg:yunpanxunlei' }],
      } } }) };
    }
    // other providers are irrelevant for the disks scope
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  }) as unknown as typeof fetch;
  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'disks',
    limit: 10,
    diskSources: { plugins: ['jutoushe', 'melost'], channels: [] },
    cookie: '',
    fetchImpl,
  });
  const disk = groups.find((group) => group.appId === 'pansou');
  // request carried the plugins list and the channels placeholder
  const requestUrl = seenUrls[0];
  assert.match(requestUrl, /plugins=jutoushe%2Cmelost|plugins=jutoushe,melost/);
  assert.match(requestUrl, /channels=__none__/);
  // duplicate share link collapsed to one entry (first/best-ranked kept)
  assert.equal(disk?.results.length, 3);
  const titles = (disk?.results || []).map((r) => r.title);
  assert.deepEqual(titles, ['Same link A', 'Unique link B', 'Baidu link']);
  // facets count the deduped stream
  assert.deepEqual((disk?.facets || []).map((f) => `${f.key}:${f.count}`), ['baidu:1', 'quark:2']);
});

test('DisksProvider applies the cloud-type whitelist to results and facets', async () => {
  _bindGetSessionTokens(() => ({ 'ai-draw': 'test-token' }));
  const fetchImpl = (async (url: string) => {
    if (url.includes('127.0.0.1:3008/api/search')) {
      return { ok: true, status: 200, json: async () => ({ data: { merged_by_type: {
        quark: [{ url: 'https://pan.quark.cn/s/q1', note: 'Q', source: 'plugin:melost' }],
        magnet: [{ url: 'magnet:?xt=urn:btih:A', note: 'M', source: 'plugin:clmao' }],
        baidu: [{ url: 'https://pan.baidu.com/s/b1', note: 'B', source: 'tg:x' }],
      } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  }) as unknown as typeof fetch;
  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'disks',
    limit: 10,
    diskSources: { cloudTypes: ['quark'] },
    cookie: '',
    fetchImpl,
  });
  const disk = groups.find((group) => group.appId === 'pansou');
  // only quark survives the whitelist (magnet/baidu filtered, unknown would pass)
  assert.deepEqual((disk?.results || []).map((r) => r.title), ['Q']);
  assert.deepEqual((disk?.facets || []).map((f) => `${f.key}:${f.count}`), ['quark:1']);
  assert.equal(disk?.hasMore, false);
});

test('disk type channel filters results while keeping global facets', async () => {
  _bindGetSessionTokens(() => ({ 'ai-draw': 'test-token' }));
  const toolsDir = path.resolve('apps/tools/public/locales/zh');
  const fetchImpl = makeFetchImpl({ toolsDir });
  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'disks',
    limit: 5,
    diskType: 'magnet',
    cookie: '',
    fetchImpl,
  });
  const disk = groups.find((group) => group.appId === 'pansou');
  assert.equal(disk?.results.length, 2);
  assert.ok((disk?.results || []).every((r) => r.meta?.linkType === 'magnet'));
  assert.deepEqual((disk?.facets || []).map((f) => f.key), ['magnet', 'quark']);
  assert.equal(disk?.hasMore, false);
});

test('builds disk facet tabs with canonical order, short labels and unknown last', () => {  const facets = buildDiskFacets({
    quark: 3,
    magnet: 176,
    baidu: 2,
    xunlei: 2,
    unknown: 4,
    zzzcustom: 1,
  });
  assert.deepEqual(
    facets.map((f) => `${f.key}:${f.label}:${f.count}`),
    ['baidu:百度:2', 'magnet:磁力:176', 'quark:夸克:3', 'xunlei:迅雷:2', 'zzzcustom:zzzcustom:1', 'unknown:其他:4'],
  );
  assert.deepEqual(buildDiskFacets({ quark: 0, baidu: 1 }), [{ key: 'baidu', label: '百度', count: 1 }]);
  assert.deepEqual(buildDiskFacets({}), []);
});

// Build a fake fetch that returns canned JSON per URL pattern.
function makeFetchImpl(opts: {
  aidrawToken?: string;
  toolsDir?: string;
}) {
  return (async (url: string, init?: RequestInit) => {
    if (url.includes('/tv/api/search')) {
      return { ok: true, status: 200, json: async () => ({ results: [{ id: 'v1', title: 'abc Movie', source: 's', source_name: 'S' }] }) };
    }
    if (url.includes('/proxy?')) throw new Error('source failed');
    if (url.includes('/api/search')) {
      return { ok: true, status: 200, json: async () => ({ data: { merged_by_type: {
        quark: [{ url: 'https://example.com', note: 'Disk' }],
        magnet: [{ url: 'magnet:?xt=urn:btih:A', note: 'M1' }, { url: 'magnet:?xt=urn:btih:B', note: 'M2' }],
      } } }) };
    }
    if (url.includes('/api/sites')) {
      return { ok: true, status: 200, json: async () => [{ slug: 'site', name: 'Site' }] };
    }
    if (url.includes('/api/novels')) {
      return { ok: true, status: 200, json: async () => [{ slug: 'book', title: 'Book', author: 'Author' }] };
    }
    if (url.includes('/api/projects')) {
      // Check for Bearer token header
      const headers = init?.headers as Record<string, string> | undefined;
      const auth = headers?.['Authorization'] || '';
      if (!auth.includes('Bearer test-token')) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'p1', title: 'Drawing', engineType: 'gemini', thumbnail: '/t.png' }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

test('searches all providers in parallel and isolates failures', async () => {
  // Point ToolsProvider at the repo's omni-tools locale files
  const toolsDir = path.resolve('apps/tools/public/locales/zh');
  _setOmniToolsLocalesDir(toolsDir);
  // Inject a fake token getter for DrawProvider
  _bindGetSessionTokens(() => ({ 'ai-draw': 'test-token' }));
  _bindGetPortalToken(() => 'test-token');

  const fetchImpl = makeFetchImpl({ aidrawToken: 'test-token', toolsDir });
  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'all',
    limit: 5,
    cookie: '',
    fetchImpl,
  });

  const byApp = new Map(groups.map((group) => [group.appId, group]));
  assert.equal(byApp.get('lunatv')?.status, 'ok');
  assert.equal(byApp.get('lunatv')?.results[0]?.title, 'abc Movie');
  assert.equal(byApp.get('solara')?.status, 'error');
  assert.equal(byApp.get('pansou')?.status, 'ok');
  const diskFacets = byApp.get('pansou')?.facets || [];
  assert.deepEqual(
    diskFacets.map((f) => `${f.key}:${f.label}:${f.count}`),
    ['magnet:磁力:2', 'quark:夸克:1'],
  );
  assert.equal(byApp.get('tutorial')?.status, 'ok');
  // ai-draw and omni-tools are now real server-side providers (not client-provider)
  assert.equal(byApp.get('ai-draw')?.status, 'ok');
  assert.equal(byApp.get('ai-draw')?.results[0]?.title, 'Drawing');
  assert.equal(byApp.get('omni-tools')?.status, 'empty');
});

test('DrawProvider sends the portal session token as Bearer credential', async () => {
  _bindGetSessionTokens(() => ({}));
  _bindGetPortalToken(() => 'portal-session-token');

  let seenAuth = '';
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.includes('/api/projects')) {
      seenAuth = (init?.headers as Record<string, string>)?.['Authorization'] || '';
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'p1', title: 'Drawing', engineType: 'gemini' }] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;

  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'draw',
    limit: 5,
    cookie: '',
    fetchImpl,
  });
  const draw = groups.find((group) => group.appId === 'ai-draw');
  assert.equal(draw?.status, 'ok');
  assert.equal(draw?.results[0]?.title, 'Drawing');
  assert.equal(seenAuth, 'Bearer portal-session-token');
});

test('DrawProvider degrades to empty when the portal session is missing or rejected', async () => {
  _bindGetSessionTokens(() => ({}));
  _bindGetPortalToken(() => '');

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.includes('/api/projects')) {
      return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;

  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'draw',
    limit: 5,
    cookie: '',
    fetchImpl,
  });
  const draw = groups.find((group) => group.appId === 'ai-draw');
  assert.equal(draw?.status, 'empty', 'no portal token -> empty page, no error group');

  // 有令牌但上游拒绝（会话失效）→ 同样降级为空结果
  _bindGetPortalToken(() => 'expired-token');
  const groups2 = await searchServerGroups({
    query: 'abc',
    scope: 'draw',
    limit: 5,
    cookie: '',
    fetchImpl,
  });
  const draw2 = groups2.find((group) => group.appId === 'ai-draw');
  assert.equal(draw2?.status, 'empty');
  assert.equal(draw2?.error, undefined);
});

test('ToolsProvider searches tool names from locale files', async () => {
  const toolsDir = path.resolve('apps/tools/public/locales/zh');
  if (!fs.existsSync(toolsDir)) {
    // Skip in environments without the repo checkout
    return;
  }
  _setOmniToolsLocalesDir(toolsDir);

  const groups = await searchServerGroups({
    query: 'base64',
    scope: 'tools',
    limit: 10,
    cookie: '',
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].appId, 'omni-tools');
  assert.equal(groups[0].status, 'ok');
  assert.ok(groups[0].total > 0, 'should find base64-related tools');
  // The tool path should follow /tools/<category>/<toolKey> format
  const first = groups[0].results[0];
  assert.ok(first.action.href.startsWith('/tools/'), `expected /tools/ prefix, got ${first.action.href}`);
});

test('tools manifest maps camelCase locale keys to real kebab-case routes', async () => {
  const toolsDir = path.resolve('apps/tools/public/locales/zh');
  if (!fs.existsSync(toolsDir)) return; // skip without repo checkout
  _setOmniToolsLocalesDir(toolsDir);
  _bindGetSessionTokens(() => ({}));

  const groups = await searchServerGroups({
    query: 'text-replacer',
    scope: 'tools',
    limit: 10,
    cookie: '',
    fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
  });
  const tools = groups[0].results.filter((r) => r.action.href.includes('replacer'));
  assert.ok(tools.length > 0, 'should find the text replacer tool');
  // locale key is textReplacer; the real route is /tools/string/text-replacer
  for (const r of tools) {
    assert.equal(r.action.href, '/tools/string/text-replacer');
  }
});

test('tools index falls back to locale scan with kebab-case hrefs without manifest', async () => {
  const os = await import('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-locales-'));
  fs.writeFileSync(path.join(tmpDir, 'string.json'), JSON.stringify({
    textReplacer: { title: '文本替换', description: '替换文本', shortDescription: '替换' },
  }));
  _setOmniToolsLocalesDir(tmpDir);
  _bindGetSessionTokens(() => ({}));

  try {
    const groups = await searchServerGroups({
      query: '替换',
      scope: 'tools',
      limit: 10,
      cookie: '',
      fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    });
    const results = groups[0]?.results || [];
    assert.equal(results.length, 1);
    assert.equal(results[0].action.href, '/tools/string/text-replacer');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scope filtering excludes non-matching providers', async () => {
  _setOmniToolsLocalesDir('/nonexistent');
  _bindGetSessionTokens(() => ({}));

  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'tv',
    limit: 5,
    cookie: '',
    fetchImpl: makeFetchImpl({}),
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].appId, 'lunatv');
});

test('returns a page with hasMore when a provider has results beyond the requested offset', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes('/tv/api/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: Array.from({ length: 45 }, (_, index) => ({
            id: `v${index}`,
            title: `abc ${index}`,
            source: 's',
            source_name: 'S',
          })),
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;

  const groups = await searchServerGroups({
    query: 'abc',
    scope: 'tv',
    limit: 20,
    offset: 20,
    cookie: '',
    fetchImpl,
  });
  assert.equal(groups[0].results.length, 20);
  assert.equal(groups[0].results[0].title, 'abc 20');
  assert.equal(groups[0].hasMore, true);
});

test('appends a page into one provider channel without touching other channels', () => {
  const video = normalizeVideoResult({
    id: 'v1',
    title: 'abc Movie',
    source: 's',
    source_name: 'S',
  });
  const song = normalizeMusicResult({
    id: 's1',
    name: 'abc Song',
    source: 'netease',
  });
  const videoGroup: SearchGroup = {
    appId: 'lunatv',
    label: '影视',
    status: 'ok',
    total: 1,
    results: [video],
    hasMore: true,
  };
  const musicGroup: SearchGroup = {
    appId: 'solara',
    label: '音乐',
    status: 'ok',
    total: 1,
    results: [song],
    hasMore: true,
  };
  const nextPage: SearchGroup = {
    ...musicGroup,
    results: [{ ...song, id: 'netease:s2', title: 'abc Song 2' }],
  };

  const updated = appendSearchGroupPage(musicGroup, nextPage);
  assert.equal(updated.results.length, 2);
  assert.equal(updated.total, 2);
  assert.equal(updated.results[1].id, 'netease:s2');
  assert.deepEqual(videoGroup, {
    appId: 'lunatv',
    label: '影视',
    status: 'ok',
    total: 1,
    results: [video],
    hasMore: true,
  });

  const duplicated = appendSearchGroupPage(updated, {
    ...nextPage,
    results: [updated.results[0]],
    hasMore: true,
  });
  assert.equal(duplicated.results.length, 2);
  assert.equal(duplicated.hasMore, false);
});
