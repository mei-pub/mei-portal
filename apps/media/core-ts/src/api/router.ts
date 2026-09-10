// api/router —— gin router.go 的复刻：node:http 原生路由（无框架）

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import http from 'node:http';
import { resolveLang, type Lang } from '../i18n.ts';
import { MSG, tLang } from '../i18n.ts';
import { checkAuth } from './auth.ts';
import type { Ctx, Handlers } from './handlers.ts';
import { serveVideoFile, type VideoService } from './video.ts';

export interface RouterOptions {
  handlers: Handlers;
  videoSvc: VideoService | null;
  staticDir: string;
  playerDir: string;
  getConfigLang: () => unknown;
}

type RouteHandler = (c: Ctx) => void;

interface Route {
  method: string;
  parts: string[]; // ':name' 段为参数
  handler: RouteHandler;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** 创建 HTTP 服务器并装配路由 */
export function createServer(opts: RouterOptions): Server {
  const { handlers: h, videoSvc } = opts;

  // 路由表（顺序即优先级：静态段路由排在参数路由之前）
  const routes: Route[] = [
    { method: 'GET', parts: ['healthy'], handler: (c) => h.health(c) },

    // tasks（内存队列）
    { method: 'POST', parts: ['api', 'tasks'], handler: (c) => h.taskCreate(c) },
    { method: 'GET', parts: ['api', 'tasks'], handler: (c) => h.taskList(c) },
    { method: 'GET', parts: ['api', 'tasks', ':id'], handler: (c) => h.taskGet(c) },
    { method: 'POST', parts: ['api', 'tasks', ':id', 'stop'], handler: (c) => h.taskStop(c) },
    { method: 'GET', parts: ['api', 'tasks', ':id', 'logs'], handler: (c) => h.taskLogs(c) },

    // config
    { method: 'GET', parts: ['api', 'config'], handler: (c) => h.configGetStore(c) },
    { method: 'POST', parts: ['api', 'config'], handler: (c) => h.configUpdate(c) },
    { method: 'GET', parts: ['api', 'config', ':key'], handler: (c) => h.configGetKey(c) },
    { method: 'PUT', parts: ['api', 'config', ':key'], handler: (c) => h.configSetKey(c) },

    // auth（setup/signin 已移除：不注册 → /api 404）
    { method: 'GET', parts: ['api', 'auth', 'status'], handler: (c) => h.authStatus(c) },

    // events / utility
    { method: 'GET', parts: ['api', 'events'], handler: (c) => h.eventsStream(c) },
    { method: 'GET', parts: ['api', 'url', 'title'], handler: (c) => h.urlTitle(c) },
    { method: 'GET', parts: ['api', 'env'], handler: (c) => h.envPaths(c) },

    // downloads（静态段在前，:id 在后）
    { method: 'POST', parts: ['api', 'downloads'], handler: (c) => h.downloadCreate(c) },
    { method: 'GET', parts: ['api', 'downloads'], handler: (c) => h.downloadList(c) },
    { method: 'GET', parts: ['api', 'downloads', 'folders'], handler: (c) => h.downloadFolders(c) },
    { method: 'GET', parts: ['api', 'downloads', 'export'], handler: (c) => h.downloadExport(c) },
    { method: 'GET', parts: ['api', 'downloads', 'active'], handler: (c) => h.downloadActive(c) },
    { method: 'PUT', parts: ['api', 'downloads', 'status'], handler: (c) => h.downloadUpdateStatus(c) },
    { method: 'GET', parts: ['api', 'downloads', ':id'], handler: (c) => h.downloadGet(c) },
    { method: 'PUT', parts: ['api', 'downloads', ':id'], handler: (c) => h.downloadEdit(c) },
    { method: 'DELETE', parts: ['api', 'downloads', ':id'], handler: (c) => h.downloadDelete(c) },
    { method: 'POST', parts: ['api', 'downloads', ':id', 'start'], handler: (c) => h.downloadStart(c) },
    { method: 'POST', parts: ['api', 'downloads', ':id', 'stop'], handler: (c) => h.downloadStop(c) },
    { method: 'PUT', parts: ['api', 'downloads', ':id', 'live'], handler: (c) => h.downloadUpdateIsLive(c) },
    { method: 'GET', parts: ['api', 'downloads', ':id', 'logs'], handler: (c) => h.downloadLogs(c) },

    // favorites
    { method: 'GET', parts: ['api', 'favorites'], handler: (c) => h.favoriteList(c) },
    { method: 'POST', parts: ['api', 'favorites'], handler: (c) => h.favoriteCreate(c) },
    { method: 'GET', parts: ['api', 'favorites', 'export'], handler: (c) => h.favoriteExport(c) },
    { method: 'POST', parts: ['api', 'favorites', 'import'], handler: (c) => h.favoriteImport(c) },
    { method: 'DELETE', parts: ['api', 'favorites', ':id'], handler: (c) => h.favoriteDelete(c) },

    // conversions
    { method: 'GET', parts: ['api', 'conversions'], handler: (c) => h.conversionList(c) },
    { method: 'POST', parts: ['api', 'conversions'], handler: (c) => h.conversionCreate(c) },
    { method: 'DELETE', parts: ['api', 'conversions', ':id'], handler: (c) => h.conversionDelete(c) },
    { method: 'GET', parts: ['api', 'conversions', ':id'], handler: (c) => h.conversionGet(c) },
    { method: 'POST', parts: ['api', 'conversions', ':id', 'start'], handler: (c) => h.conversionStart(c) },
    { method: 'POST', parts: ['api', 'conversions', ':id', 'stop'], handler: (c) => h.conversionStop(c) },

    // 播放器 API
    { method: 'GET', parts: ['api', 'v1', 'videos'], handler: (c) => h.videosList(c) },
    { method: 'GET', parts: ['api', 'v1', 'videos', ':id'], handler: (c) => h.videoGet(c) },
  ];

  const server = http.createServer((req, res) => {
    handleRequest(req, res, routes, opts).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      try {
        res.end(JSON.stringify({ success: false, code: 500, message: err?.message ?? 'internal error' }));
      } catch {
        // 连接已断开
      }
    });
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: Route[],
  opts: RouterOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // CORS（对应 gin-contrib/cors：* 源 + 常用方法/头 + credentials）
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 鉴权（白名单外需门户会话）
  if (!checkAuth(req)) {
    const lang = resolveLang(url.searchParams.get('lang') ?? undefined, req.headers['accept-language'] as string | undefined, opts.getConfigLang());
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, code: 401, message: tLang(lang, MSG.UNAUTHORIZED) }));
    return;
  }

  // ---- 静态资源（白名单路径）----

  // /assets/* → staticDir/assets
  if (pathname.startsWith('/assets/')) {
    serveStaticFile(res, path.join(opts.staticDir, 'assets'), pathname.slice('/assets/'.length));
    return;
  }
  if (pathname === '/favicon.ico') {
    serveStaticFile(res, opts.staticDir, 'favicon.ico');
    return;
  }

  // /player/* → 播放器 SPA（嵌入 UI 的等价物：目录形式部署，缺失时 404）
  if (pathname === '/player' || pathname.startsWith('/player/')) {
    serveSPA(res, opts.playerDir, pathname.slice('/player'.length) || '/');
    return;
  }

  // /videos/:id → HTTP Range 流式播放
  const videosMatch = /^\/videos\/([^/]+)$/.exec(pathname);
  if (videosMatch) {
    const id = Number.parseInt(videosMatch[1]!, 10);
    if (Number.isNaN(id) || !opts.videoSvc) {
      jsonError(res, 404, 'video file not found');
      return;
    }
    const filePath = opts.videoSvc.getVideoFilePath(id);
    if (!filePath) {
      jsonError(res, 404, 'video file not found');
      return;
    }
    serveVideoFile(req, res, filePath);
    return;
  }

  // ---- API 路由匹配 ----

  const parts = pathname.split('/').filter((p) => p !== '');
  for (const route of routes) {
    if (route.method !== req.method) continue;
    const params = matchParts(route.parts, parts);
    if (!params) continue;

    const lang = resolveLang(
      url.searchParams.get('lang') ?? undefined,
      req.headers['accept-language'] as string | undefined,
      opts.getConfigLang(),
    );
    const ctx: Ctx = { req, res, url, params, lang };
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      ctx.body = await readBody(req);
    }
    route.handler(ctx);
    return;
  }

  // 未匹配：API 路径 → 404 JSON（含已移除的 /api/auth/setup、/api/auth/signin）
  if (pathname.startsWith('/api/')) {
    jsonError(res, 404, '404 page not found');
    return;
  }

  // 其余 → SPA fallback：index.html（无 static-dir 时 404）
  serveSPA(res, opts.staticDir, pathname);
}

function matchParts(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = actual[i]!;
    else if (p !== actual[i]) return null;
  }
  return params;
}

function setCors(res: ServerResponse, origin: string | undefined): void {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, X-API-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, code: status, message }));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > 16 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // 让 handler 的 asObject 校验报 400
  }
}

/** 单个静态文件（rootDir 内 + 目录穿越防护） */
function serveStaticFile(res: ServerResponse, rootDir: string, relPath: string): void {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(path.join(rootDir, relPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    jsonError(res, 404, '404 page not found');
    return;
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    jsonError(res, 404, '404 page not found');
    return;
  }
  const type = MIME[path.extname(resolved).toLowerCase()];
  res.writeHead(200, {
    'Content-Type': type ?? 'application/octet-stream',
    'Content-Length': String(data.length),
  });
  res.end(data);
}

/** SPA：精确命中文件 → 文件；否则 fallback 到 index.html */
function serveSPA(res: ServerResponse, dir: string, urlPath: string): void {
  if (dir === '' || !fs.existsSync(dir)) {
    jsonError(res, 404, '404 page not found');
    return;
  }
  const rel = urlPath.replace(/^\/+/, '');
  let target = rel === '' ? path.join(dir, 'index.html') : path.join(dir, rel);
  let stats: fs.Stats | null = null;
  try {
    stats = fs.statSync(target);
  } catch {
    stats = null;
  }
  if (!stats || stats.isDirectory()) {
    // 目录（或未命中）→ fallback index.html
    const indexPath = path.join(dir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      jsonError(res, 404, '404 page not found');
      return;
    }
    target = indexPath;
  }
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(dir))) {
    jsonError(res, 404, '404 page not found');
    return;
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    jsonError(res, 404, '404 page not found');
    return;
  }
  const type = MIME[path.extname(resolved).toLowerCase()];
  res.writeHead(200, {
    'Content-Type': type ?? 'text/html; charset=utf-8',
    'Content-Length': String(data.length),
  });
  res.end(data);
}
