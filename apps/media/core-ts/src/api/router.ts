// api/router —— gin router.go 的复刻：node:http 原生路由（无框架）

import fs from "node:fs";
import path from "node:path";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { MSG, resolveLang, tLang } from "../i18n.ts";
import { checkAuth } from "./auth.ts";
import type { Ctx, Handlers } from "./handlers.ts";
import {
  serveFileAttachment,
  serveVideoFile,
  type VideoService,
} from "./video.ts";

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
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** 创建 HTTP 服务器并装配路由 */
export function createServer(opts: RouterOptions): Server {
  const { handlers: h } = opts;

  // 路由表（顺序即优先级：静态段路由排在参数路由之前）
  const routes: Route[] = [
    { method: "GET", parts: ["healthy"], handler: (c) => h.health(c) },

    // tasks（内存队列）
    {
      method: "POST",
      parts: ["api", "tasks"],
      handler: (c) => h.taskCreate(c),
    },
    { method: "GET", parts: ["api", "tasks"], handler: (c) => h.taskList(c) },
    {
      method: "GET",
      parts: ["api", "tasks", ":id"],
      handler: (c) => h.taskGet(c),
    },
    {
      method: "POST",
      parts: ["api", "tasks", ":id", "stop"],
      handler: (c) => h.taskStop(c),
    },
    {
      method: "GET",
      parts: ["api", "tasks", ":id", "logs"],
      handler: (c) => h.taskLogs(c),
    },

    // config
    {
      method: "GET",
      parts: ["api", "config"],
      handler: (c) => h.configGetStore(c),
    },
    {
      method: "POST",
      parts: ["api", "config"],
      handler: (c) => h.configUpdate(c),
    },
    {
      method: "GET",
      parts: ["api", "config", ":key"],
      handler: (c) => h.configGetKey(c),
    },
    {
      method: "PUT",
      parts: ["api", "config", ":key"],
      handler: (c) => h.configSetKey(c),
    },

    // auth（setup/signin 已移除：不注册 → /api 404）
    {
      method: "GET",
      parts: ["api", "auth", "status"],
      handler: (c) => h.authStatus(c),
    },

    // events / utility
    {
      method: "GET",
      parts: ["api", "events"],
      handler: (c) => h.eventsStream(c),
    },
    {
      method: "GET",
      parts: ["api", "url", "title"],
      handler: (c) => h.urlTitle(c),
    },
    { method: "GET", parts: ["api", "env"], handler: (c) => h.envPaths(c) },

    // torrent 上传（种子文件模式的元数据解析 + 落盘）
    {
      method: "POST",
      parts: ["api", "upload", "torrent"],
      handler: (c) => h.uploadTorrent(c),
    },

    // 磁力链接内容解析（创建任务前的强制内容识别：名称/大小/文件清单）——
    // FluxDown 引擎解析会话（网关种子直供秒出 / DHT 兜底）
    {
      method: "POST",
      parts: ["api", "downloads", "resolve-magnet"],
      handler: (c) => h.resolveMagnet(c),
    },
    // 弃置解析会话（表单取消/关闭时清理，不留引擎半成品）
    {
      method: "POST",
      parts: ["api", "downloads", "discard-magnet"],
      handler: (c) => h.discardMagnet(c),
    },
    // 下载引擎接入信息（FluxDown：aria2 兼容 RPC 接入 + 引擎控制台）
    {
      method: "GET",
      parts: ["api", "downloads", "engines"],
      handler: (c) => h.getEngines(c),
    },
    // 引擎配置（BT/DHT/UPnP/MSE/tracker/做种/限速/并发/文件冲突——引擎为事实源）
    {
      method: "GET",
      parts: ["api", "downloads", "engine-config"],
      handler: (c) => h.engineConfigGet(c),
    },
    {
      method: "PATCH",
      parts: ["api", "downloads", "engine-config"],
      handler: (c) => h.engineConfigPatch(c),
    },
    // tracker 订阅立即刷新（订阅源拉最新公共 tracker 清单）
    {
      method: "POST",
      parts: ["api", "downloads", "engine-trackers", "refresh"],
      handler: (c) => h.engineTrackerRefresh(c),
    },
    // eD2K 服务器列表订阅刷新（server.met 找源网络维护）
    {
      method: "POST",
      parts: ["api", "downloads", "engine-ed2k", "refresh"],
      handler: (c) => h.engineEd2kRefresh(c),
    },
    // 引擎产物文件跟踪重扫（fileMissing 全量盘点）
    {
      method: "POST",
      parts: ["api", "downloads", "engine-rescan"],
      handler: (c) => h.engineRescan(c),
    },
    // 引擎任务批量操作（全部暂停/开始；action: pause|resume + ids 或 all）
    {
      method: "POST",
      parts: ["api", "downloads", "engine-batch"],
      handler: (c) => h.engineBatch(c),
    },
    // 目录浏览（新建下载保存目录选择；限 /downloads 子树）
    {
      method: "GET",
      parts: ["api", "downloads", "fs"],
      handler: (c) => h.engineFsList(c),
    },
    // 目录浏览内新建目录（core 直写；限 /downloads 子树）
    {
      method: "POST",
      parts: ["api", "downloads", "fs", "mkdir"],
      handler: (c) => h.engineFsMkdir(c),
    },
    // 引擎全局运行统计（下载页头部速度/活跃/磁盘）
    {
      method: "GET",
      parts: ["api", "downloads", "engine-stats"],
      handler: (c) => h.engineStats(c),
    },
    // 每任务做种限制覆盖（详情抽屉）
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "seed-limits"],
      handler: (c) => h.engineSeedLimits(c),
    },
    // ---- 命名队列（daemon.queue.* 代理）----
    {
      method: "GET",
      parts: ["api", "downloads", "engine-queues"],
      handler: (c) => h.engineQueuesList(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "engine-queues"],
      handler: (c) => h.engineQueueCreate(c),
    },
    {
      method: "PUT",
      parts: ["api", "downloads", "engine-queues"],
      handler: (c) => h.engineQueueUpdate(c),
    },
    {
      method: "DELETE",
      parts: ["api", "downloads", "engine-queues", ":queueId"],
      handler: (c) => h.engineQueueDelete(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "engine-queues", ":queueId", "start"],
      handler: (c) => h.engineQueueStart(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "engine-queues", ":queueId", "stop"],
      handler: (c) => h.engineQueueStop(c),
    },
    // 任务挪队列 / 插队（任务行操作：详情抽屉）
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "queue"],
      handler: (c) => h.engineTaskQueueMove(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "boost"],
      handler: (c) => h.engineTaskQueueBoost(c),
    },
    // ---- RSS 订阅（daemon.rss.* 代理）----
    // 源 CRUD / 条目 / 校验 / 刷新
    {
      method: "GET",
      parts: ["api", "downloads", "rss", "sources"],
      handler: (c) => h.rssSourcesList(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "rss", "sources"],
      handler: (c) => h.rssSourceCreate(c),
    },
    {
      method: "PUT",
      parts: ["api", "downloads", "rss", "sources"],
      handler: (c) => h.rssSourceUpdate(c),
    },
    {
      method: "DELETE",
      parts: ["api", "downloads", "rss", "sources", ":sourceId"],
      handler: (c) => h.rssSourceDelete(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "rss", "sources", ":sourceId", "refresh"],
      handler: (c) => h.rssSourceRefresh(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", "rss", "sources", ":sourceId", "items"],
      handler: (c) => h.rssSourceItems(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "rss", "sources", ":sourceId", "action"],
      handler: (c) => h.rssItemAction(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", "rss", "validate"],
      handler: (c) => h.rssValidate(c),
    },
    // 引擎任务操作（任务行操作：改名 / 换源）
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "rename"],
      handler: (c) => h.taskRename(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "change-url"],
      handler: (c) => h.taskChangeUrl(c),
    },
    // 引擎任务详情（任务详情抽屉：任务快照 + 活动日志 + 实时数据）
    {
      method: "GET",
      parts: ["api", "downloads", ":id", "engine-detail"],
      handler: (c) => h.engineTaskDetail(c),
    },

    // downloads（静态段在前，:id 在后）
    {
      method: "POST",
      parts: ["api", "downloads"],
      handler: (c) => h.downloadCreate(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads"],
      handler: (c) => h.downloadList(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", "folders"],
      handler: (c) => h.downloadFolders(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", "export"],
      handler: (c) => h.downloadExport(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", "active"],
      handler: (c) => h.downloadActive(c),
    },
    {
      method: "PUT",
      parts: ["api", "downloads", "status"],
      handler: (c) => h.downloadUpdateStatus(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", ":id"],
      handler: (c) => h.downloadGet(c),
    },
    {
      method: "PUT",
      parts: ["api", "downloads", ":id"],
      handler: (c) => h.downloadEdit(c),
    },
    {
      method: "DELETE",
      parts: ["api", "downloads", ":id"],
      handler: (c) => h.downloadDelete(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "start"],
      handler: (c) => h.downloadStart(c),
    },
    {
      method: "POST",
      parts: ["api", "downloads", ":id", "stop"],
      handler: (c) => h.downloadStop(c),
    },
    {
      method: "PUT",
      parts: ["api", "downloads", ":id", "live"],
      handler: (c) => h.downloadUpdateIsLive(c),
    },
    {
      method: "GET",
      parts: ["api", "downloads", ":id", "logs"],
      handler: (c) => h.downloadLogs(c),
    },

    // favorites
    {
      method: "GET",
      parts: ["api", "favorites"],
      handler: (c) => h.favoriteList(c),
    },
    {
      method: "POST",
      parts: ["api", "favorites"],
      handler: (c) => h.favoriteCreate(c),
    },
    {
      method: "GET",
      parts: ["api", "favorites", "export"],
      handler: (c) => h.favoriteExport(c),
    },
    {
      method: "POST",
      parts: ["api", "favorites", "import"],
      handler: (c) => h.favoriteImport(c),
    },
    {
      method: "DELETE",
      parts: ["api", "favorites", ":id"],
      handler: (c) => h.favoriteDelete(c),
    },

    // conversions
    {
      method: "GET",
      parts: ["api", "conversions"],
      handler: (c) => h.conversionList(c),
    },
    {
      method: "POST",
      parts: ["api", "conversions"],
      handler: (c) => h.conversionCreate(c),
    },
    {
      method: "DELETE",
      parts: ["api", "conversions", ":id"],
      handler: (c) => h.conversionDelete(c),
    },
    {
      method: "GET",
      parts: ["api", "conversions", ":id"],
      handler: (c) => h.conversionGet(c),
    },
    {
      method: "POST",
      parts: ["api", "conversions", ":id", "start"],
      handler: (c) => h.conversionStart(c),
    },
    {
      method: "POST",
      parts: ["api", "conversions", ":id", "stop"],
      handler: (c) => h.conversionStop(c),
    },

    // 播放器 API
    {
      method: "GET",
      parts: ["api", "v1", "videos"],
      handler: (c) => h.videosList(c),
    },
    {
      method: "GET",
      parts: ["api", "v1", "videos", ":id"],
      handler: (c) => h.videoGet(c),
    },
  ];

  const server = http.createServer((req, res) => {
    // 连接级流错误兜底：客户端中途断开时，后续对 req/res 的读写会以
    // 'error' 事件抛出（ERR_STREAM_DESTROYED 等），无监听器则直接击穿进程。
    req.on("error", () => {});
    res.on("error", () => {});
    handleRequest(req, res, routes, opts).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
        });
      }
      try {
        res.end(
          JSON.stringify({
            success: false,
            code: 500,
            message: err?.message ?? "internal error",
          }),
        );
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
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname; // 非法百分号序列 —— 按原样处理（路由必然 404）
  }

  // CORS（对应 gin-contrib/cors：* 源 + 常用方法/头 + credentials）
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 鉴权（白名单外需门户会话；与 Go 一致使用解码后的路径判定）
  if (!checkAuth(req, pathname)) {
    const lang = resolveLang(
      url.searchParams.get("lang") ?? undefined,
      req.headers["accept-language"] as string | undefined,
      opts.getConfigLang(),
    );
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        success: false,
        code: 401,
        message: tLang(lang, MSG.UNAUTHORIZED),
      }),
    );
    return;
  }

  // ---- 静态资源（白名单路径）----

  // /assets/* → staticDir/assets（staticDir 未配置时不得以进程 cwd 充当根目录）
  if (pathname.startsWith("/assets/")) {
    if (opts.staticDir === "") {
      jsonError(res, 404, "404 page not found");
      return;
    }
    serveStaticFile(
      req,
      res,
      path.join(opts.staticDir, "assets"),
      pathname.slice("/assets/".length),
    );
    return;
  }
  if (pathname === "/favicon.ico") {
    if (opts.staticDir === "") {
      jsonError(res, 404, "404 page not found");
      return;
    }
    serveStaticFile(req, res, opts.staticDir, "favicon.ico");
    return;
  }

  // /player/* → 播放器 SPA（嵌入 UI 的等价物：目录形式部署，缺失时 404）
  if (pathname === "/player" || pathname.startsWith("/player/")) {
    serveSPA(req, res, opts.playerDir, pathname.slice("/player".length) || "/");
    return;
  }

  // /videos/:id → HTTP Range 流式播放
  const videosMatch = /^\/videos\/([^/]+)$/.exec(pathname);
  if (videosMatch) {
    const id = Number.parseInt(videosMatch[1]!, 10);
    if (Number.isNaN(id) || !opts.videoSvc) {
      jsonError(res, 404, "video file not found");
      return;
    }
    const filePath = opts.videoSvc.getVideoFilePath(id);
    if (!filePath) {
      jsonError(res, 404, "video file not found");
      return;
    }
    serveVideoFile(req, res, filePath);
    return;
  }

  // /files/:id → 附件下载（任意扩展的普通下载产物；免鉴权同 /videos，
  // 下载到本地电脑由浏览器接收 attachment 响应）
  const filesMatch = /^\/files\/([^/]+)$/.exec(pathname);
  if (filesMatch) {
    const id = Number.parseInt(filesMatch[1]!, 10);
    if (Number.isNaN(id) || !opts.videoSvc) {
      jsonError(res, 404, "file not found");
      return;
    }
    const file = opts.videoSvc.getFileForDownload(id);
    if (!file) {
      jsonError(res, 404, "file not found");
      return;
    }
    serveFileAttachment(req, res, file.filePath, file.fileName);
    return;
  }

  // ---- API 路由匹配 ----

  const parts = pathname.split("/").filter((p) => p !== "");
  for (const route of routes) {
    if (route.method !== req.method) continue;
    const params = matchParts(route.parts, parts);
    if (!params) continue;

    const lang = resolveLang(
      url.searchParams.get("lang") ?? undefined,
      req.headers["accept-language"] as string | undefined,
      opts.getConfigLang(),
    );
    const ctx: Ctx = { req, res, url, params, lang };
    if (
      req.method === "POST" ||
      req.method === "PUT" ||
      req.method === "PATCH" ||
      req.method === "DELETE"
    ) {
      ctx.body = await readBody(req);
    }
    route.handler(ctx);
    return;
  }

  // 未匹配：API 路径 → 404 JSON（含已移除的 /api/auth/setup、/api/auth/signin）
  if (pathname.startsWith("/api/")) {
    jsonError(res, 404, "404 page not found");
    return;
  }

  // 其余 → SPA fallback：index.html（无 static-dir 时 404）
  serveSPA(req, res, opts.staticDir, pathname);
}

function matchParts(
  pattern: string[],
  actual: string[],
): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = actual[i]!;
    else if (p !== actual[i]) return null;
  }
  return params;
}

function setCors(res: ServerResponse, origin: string | undefined): void {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, Content-Type, Accept, Authorization, X-API-Key",
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Length");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ success: false, code: status, message }));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > 16 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // 让 handler 的 asObject 校验报 400
  }
}

/** 单个静态文件（rootDir 内 + 目录穿越防护；HEAD 不回 body） */
function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string,
  relPath: string,
): void {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(path.join(rootDir, relPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    jsonError(res, 404, "404 page not found");
    return;
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    jsonError(res, 404, "404 page not found");
    return;
  }
  const type = MIME[path.extname(resolved).toLowerCase()];
  const headers = {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": String(data.length),
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(data);
}

/** SPA：精确命中文件 → 文件；否则 fallback 到 index.html */
function serveSPA(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  urlPath: string,
): void {
  if (dir === "" || !fs.existsSync(dir)) {
    jsonError(res, 404, "404 page not found");
    return;
  }
  const rel = urlPath.replace(/^\/+/, "");
  let target = rel === "" ? path.join(dir, "index.html") : path.join(dir, rel);
  let stats: fs.Stats | null = null;
  try {
    stats = fs.statSync(target);
  } catch {
    stats = null;
  }
  if (!stats || stats.isDirectory()) {
    // 目录（或未命中）→ fallback index.html
    const indexPath = path.join(dir, "index.html");
    if (!fs.existsSync(indexPath)) {
      jsonError(res, 404, "404 page not found");
      return;
    }
    target = indexPath;
  }
  const root = path.resolve(dir);
  const resolved = path.resolve(target);
  // 必须带路径分隔符比较：否则 /player/../playerX 命中同级 playerX 前缀目录（路径逃逸）
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    jsonError(res, 404, "404 page not found");
    return;
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    jsonError(res, 404, "404 page not found");
    return;
  }
  const type = MIME[path.extname(resolved).toLowerCase()];
  const headers: Record<string, string> = {
    "Content-Type": type ?? "text/html; charset=utf-8",
    "Content-Length": String(data.length),
  };
  // 缓存策略：HTML 入口 no-cache（每次协商，热部署即时生效——否则浏览器
  // 启发式缓存住旧 index，继续引用旧 hash 包，UI 更新对用户不可见）；
  // 带内容 hash 的静态产物（Vite assets/*）永久缓存。
  const ext = path.extname(resolved).toLowerCase();
  const isHashedAsset =
    !["", ".html"].includes(ext) && /-[A-Za-z0-9_-]{6,}\.(js|css|mjs)$/i.test(path.basename(resolved));
  if (ext === ".html" || ext === "") {
    headers["Cache-Control"] = "no-cache";
  } else if (isHashedAsset) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(data);
}
