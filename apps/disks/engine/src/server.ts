// HTTP 服务 —— Go api/ 的对应物（node:http 原生实现，无框架依赖）
// 路由与响应结构 /api/search /api/health /api/auth/* /api/check/links 与 Go 版完全一致

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.ts';
import { authenticate, checkCredentials, issueToken, verifyToken } from './auth.ts';
import { cache } from './cache.ts';
import { search } from './service/search.ts';
import { checkLinks } from './service/check.ts';
import { filterEnabledPlugins, getPlugins, getWebRoutes } from './plugins/registry.ts';
import { enabledPluginDefs } from './plugins/index.ts';
import { newErrorResponse, newSuccessResponse, type CheckItem, type CheckRequest, type FilterConfig, type SearchRequest, type SearchResponse, type SearchResult } from './types.ts';

/**
 * 应用结果过滤器（Go api/filter.go applyResultFilter 的对应物）：
 * - exclude 任一命中即排除；include 非空时至少须命中一个；关键词与文本均小写匹配
 * - merged_by_type / all：按 note 过滤各分组并剔除空分组
 * - all / results：按 title 过滤结果，链接按 work_title（缺省回退 title）过滤，无链接的结果剔除
 * - total 按过滤后结果重算
 */
export function applyResultFilter(response: SearchResponse, filter: FilterConfig, resultType: string): SearchResponse {
  if ((filter.include?.length ?? 0) === 0 && (filter.exclude?.length ?? 0) === 0) return response;

  const includeKeywords = (filter.include ?? []).map((kw) => kw.toLowerCase());
  const excludeKeywords = (filter.exclude ?? []).map((kw) => kw.toLowerCase());
  const matchFilter = (text: string): boolean => {
    const lower = text.toLowerCase();
    if (excludeKeywords.some((kw) => lower.includes(kw))) return false;
    if (includeKeywords.length > 0 && !includeKeywords.some((kw) => lower.includes(kw))) return false;
    return true;
  };
  const filterMerged = (merged: SearchResponse['merged_by_type']): SearchResponse['merged_by_type'] =>
    merged
      ? Object.fromEntries(
          Object.entries(merged)
            .map(([type, links]) => [type, links.filter((l) => matchFilter(l.note))] as const)
            .filter(([, links]) => links.length > 0),
        )
      : undefined;

  if (resultType === 'merged_by_type') {
    const merged = filterMerged(response.merged_by_type);
    return {
      total: Object.values(merged ?? {}).reduce((sum, links) => sum + links.length, 0),
      merged_by_type: merged,
    };
  }
  // all / results
  const results = (response.results ?? [])
    .filter((r) => matchFilter(r.title))
    .map((r) => {
      const links = r.links.filter((l) => matchFilter(l.work_title && l.work_title !== '' ? l.work_title : r.title));
      return links.length > 0 ? { ...r, links } : null;
    })
    .filter((r): r is SearchResult => r !== null);
  if (resultType === 'all') {
    return { total: results.length, results, merged_by_type: filterMerged(response.merged_by_type) };
  }
  return { total: results.length, results };
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let rejected = false;
    req.on('data', (chunk) => {
      // 超限时立即拒绝并暂停接收：停止内存累积（攻击面），同时让错误响应能正常送达客户端
      if (rejected || data.length > 10 * 1024 * 1024) {
        if (!rejected) {
          rejected = true;
          reject(new Error('body too large'));
          req.pause();
        }
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!rejected) resolve(data);
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

function parseCSV(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** 将请求参数规整为 SearchParams（handler.go 的 GET/POST 解析 + 默认值 + 互斥规则） */
async function buildSearchRequest(req: IncomingMessage): Promise<SearchRequest | { error: string }> {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/api/search', 'http://localhost');
    const q = url.searchParams;
    const kw = q.get('kw') ?? '';
    let resultType = q.get('res') ?? '';
    if (resultType === '' || resultType === ' ') resultType = 'merge';
    let sourceType = q.get('src') ?? '';
    if (sourceType === '' || sourceType === ' ') sourceType = 'all';

    let ext: Record<string, unknown> = {};
    const extStr = q.get('ext') ?? '';
    if (extStr !== '' && extStr !== ' ') {
      if (extStr !== '{}') {
        try {
          ext = JSON.parse(extStr) as Record<string, unknown>;
        } catch (err) {
          return { error: `无效的ext参数格式: ${err instanceof Error ? err.message : err}` };
        }
      }
    }
    let filter;
    const filterStr = q.get('filter') ?? '';
    if (filterStr !== '' && filterStr !== ' ') {
      try {
        filter = JSON.parse(filterStr) as { include?: string[]; exclude?: string[] };
      } catch (err) {
        return { error: `无效的filter参数格式: ${err instanceof Error ? err.message : err}` };
      }
    }
    return {
      kw,
      channels: parseCSV(q.get('channels') ?? undefined) ?? undefined,
      conc: parseInt(q.get('conc') ?? '0', 10) || 0,
      refresh: q.get('refresh') === 'true',
      res: resultType,
      src: sourceType,
      plugins: q.has('plugins') ? parseCSV(q.get('plugins')) : null,
      cloud_types: q.has('cloud_types') ? parseCSV(q.get('cloud_types')) : null,
      ext,
      filter,
    };
  }

  // POST：JSON body，kw 必填
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as SearchRequest;
    if (!parsed.kw) return { error: '无效的请求参数: Key: \'SearchRequest.Keyword\' Error:Field validation for \'Keyword\' failed on the \'required\' tag' };
    return parsed;
  } catch (err) {
    return { error: `无效的请求参数: ${err instanceof Error ? err.message : err}` };
  }
}

/** 插件参数规整（Search() 的规范化：全量列表 → null，共享「全部」缓存键） */
function normalizePlugins(plugins: string[] | null): string[] | null {
  if (plugins === null || plugins.length === 0) return null;
  if (!plugins.some((p) => p !== '')) return null;
  const wanted = new Set(plugins.filter((p) => p !== '').map((p) => p.toLowerCase()));
  const all = enabledPluginDefs().map((p) => p.name.toLowerCase());
  if (all.length > 0 && all.every((name) => wanted.has(name))) return null;
  return plugins.filter((p) => p !== '');
}

async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const built = await buildSearchRequest(req);
  if ('error' in built) {
    sendJSON(res, 400, newErrorResponse(400, built.error));
    return;
  }
  const request = built;
  let channels = request.channels && request.channels.length > 0 ? request.channels : config.defaultChannels;
  let resultType = request.res ?? '';
  if (resultType === '' || resultType === 'merge') resultType = 'merged_by_type';
  let sourceType = request.src ?? '';
  if (sourceType === '') sourceType = 'all';
  let plugins = request.plugins ?? null;
  if (sourceType === 'tg') plugins = null;
  else if (sourceType === 'plugin') {
    channels = [];
    // Go 对 all 与 plugin 都做「全量列表 → null」归一（共享缓存键）；漏掉 plugin 会造成缓存分裂
    plugins = normalizePlugins(plugins);
  } else plugins = normalizePlugins(plugins);

  try {
    const result = await search({
      keyword: request.kw,
      channels,
      concurrency: request.conc ?? 0,
      forceRefresh: request.refresh === true,
      resultType,
      sourceType,
      plugins,
      cloudTypes: request.cloud_types ?? null,
      ext: request.ext ?? {},
    });
    // 过滤器（filter.go 语义）
    const filtered = request.filter ? applyResultFilter(result, request.filter, resultType) : result;
    sendJSON(res, 200, newSuccessResponse(filtered));
  } catch (err) {
    sendJSON(res, 500, newErrorResponse(500, `搜索失败: ${err instanceof Error ? err.message : err}`));
  }
}

async function handleCheckLinks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as CheckRequest;
    if (!parsed.items || parsed.items.length === 0) {
      sendJSON(res, 400, newErrorResponse(400, '无效的请求参数: items 必填'));
      return;
    }
    const items: CheckItem[] = parsed.items;
    const result = await checkLinks(items);
    sendJSON(res, 200, newSuccessResponse(result));
  } catch (err) {
    sendJSON(res, 400, newErrorResponse(400, `无效的请求参数: ${err instanceof Error ? err.message : err}`));
  }
}

function handleHealth(res: ServerResponse): void {
  const enabled = filterEnabledPlugins(config.enabledPlugins);
  const response: Record<string, unknown> = {
    status: 'ok',
    auth_enabled: config.authEnabled,
    plugins_enabled: config.asyncPluginEnabled,
    channels: config.defaultChannels,
    channels_count: config.defaultChannels.length,
  };
  if (config.asyncPluginEnabled) {
    response['plugin_count'] = enabled.length;
    response['plugins'] = enabled.map((p) => p.name);
  }
  sendJSON(res, 200, response);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {});
    return;
  }

  // 认证接口（公开路径）
  if (path === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { username: string; password: string };
      if (!checkCredentials(body.username, body.password)) {
        sendJSON(res, 200, newErrorResponse(1001, '用户名或密码错误'));
        return;
      }
      sendJSON(res, 200, newSuccessResponse({ token: issueToken(body.username), expires_in: config.authTokenExpiryHours * 3600 }));
    } catch {
      sendJSON(res, 400, newErrorResponse(400, '无效的请求参数'));
    }
    return;
  }
  if (path === '/api/auth/verify' && req.method === 'POST') {
    const user = authenticate(req.headers['authorization']);
    if (user) sendJSON(res, 200, newSuccessResponse({ valid: true, username: user }));
    else sendJSON(res, 200, newErrorResponse(1002, 'token 无效或已过期'));
    return;
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    sendJSON(res, 200, newSuccessResponse({}));
    return;
  }

  // 认证中间件：AUTH_ENABLED=false 全放行
  if (!authenticate(req.headers['authorization'])) {
    sendJSON(res, 401, newErrorResponse(401, '未授权访问'));
    return;
  }

  if (path === '/api/search' && (req.method === 'GET' || req.method === 'POST')) {
    await handleSearch(req, res);
    return;
  }
  if (path === '/api/check/links' && req.method === 'POST') {
    await handleCheckLinks(req, res);
    return;
  }
  if (path === '/api/health' && req.method === 'GET') {
    handleHealth(res);
    return;
  }

  // 插件自注册 Web 路由（/gying/:param 等账号管理页，Go PluginWithWebHandler）
  for (const route of getWebRoutes()) {
    if (route.method !== req.method && !(route.method === 'GET' && req.method === 'HEAD')) continue;
    const params = matchWebRoute(route.path, path);
    if (params) {
      try {
        await route.handler(req, res, params);
      } catch (err) {
        console.error(`[server] 插件路由 ${route.path} 错误: ${err instanceof Error ? err.stack : err}`);
        if (!res.headersSent) sendJSON(res, 500, newErrorResponse(500, '内部错误'));
        else res.end();
      }
      return;
    }
  }

  sendJSON(res, 404, newErrorResponse(404, '接口不存在'));
}

/** 匹配路径模板（:param 段捕获任意非空段），返回参数或 null */
function matchWebRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((p) => p !== '');
  const pathParts = pathname.split('/').filter((p) => p !== '');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pt = patternParts[i]!;
    if (pt.startsWith(':')) {
      if (pathParts[i] === '') return null;
      // 恶意/畸形百分号编码会抛 URIError，应视为不匹配（404）而非 500
      try {
        params[pt.slice(1)] = decodeURIComponent(pathParts[i]!);
      } catch {
        return null;
      }
    } else if (pt !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function startServer(): void {
  const server = createServer((req, res) => {
    void route(req, res).catch((err) => {
      console.error(`[server] 路由错误: ${err instanceof Error ? err.stack : err}`);
      if (!res.headersSent) sendJSON(res, 500, newErrorResponse(500, '内部错误'));
      else res.end();
    });
  });

  server.listen(config.port, config.host, () => {
    const enabled = filterEnabledPlugins(config.enabledPlugins);
    console.log(
      `[disks-engine] listening on ${config.host}:${config.port} | channels: ${config.defaultChannels.length} | plugins: ${enabled.length}/${getPlugins().length} | cache: ${config.cacheEnabled ? config.cachePath : 'off'}`,
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`[disks-engine] 收到 ${signal}，落盘缓存后退出`);
    await cache.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// 入口：直接运行（node src/server.ts）时启动；被测试/其他模块 import 时不启动
import { pathToFileURL } from 'node:url';
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) startServer();
