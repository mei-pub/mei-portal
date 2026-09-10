// api/handlers —— Go internal/api/handler/* 的复刻（各端点 1:1）

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../logger.ts';
import { MSG, tLang, type Lang } from '../i18n.ts';
import type { Conf } from '../conf.ts';
import type { TaskLogManager } from '../tasklog.ts';
import type { TaskQueue } from '../core/queue.ts';
import type { TaskInfo } from '../core/types.ts';
import type { Hub } from './sse.ts';
import type { DownloadTaskService } from '../service/download.ts';
import type { FavoriteService } from '../service/favorite.ts';
import type { ConversionService } from '../service/conversion.ts';
import type { VideoService } from './video.ts';
import { isPortalSession } from './auth.ts';

export interface EnvPaths {
  configDir: string;
  binDir: string;
  platform: string;
  playerUrl: string;
}

/** 请求上下文（路由层填充） */
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  lang: Lang;
  body?: unknown;
}

// ---- 响应 DTO（对应 Go dto.SuccessResponse / dto.ErrorResponse）----

export function ok(c: Ctx, data: unknown, message?: string): void {
  json(c, 200, { success: true, code: 200, message: message ?? tLang(c.lang, MSG.OK), data });
}

export function fail(c: Ctx, status: number, message: string): void {
  json(c, status, { success: false, code: status, message });
}

export function json(c: Ctx, status: number, payload: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(payload);
  c.res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(headers ?? {}),
  });
  c.res.end(body);
}

function queryNum(c: Ctx, key: string, fallback = 0): number {
  const v = c.url.searchParams.get(key);
  if (v === null || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function intParam(c: Ctx, key: string): number | null {
  const id = Number.parseInt(c.params[key]!, 10);
  return Number.isNaN(id) ? null : id;
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export class Handlers {
  private readonly queue: TaskQueue;
  private readonly logs: TaskLogManager | null;
  private readonly conf: Conf;
  private readonly hub: Hub;
  private readonly downloadSvc: DownloadTaskService | null;
  private readonly favoriteSvc: FavoriteService | null;
  private readonly conversionSvc: ConversionService | null;
  private readonly videoSvc: VideoService | null;
  private readonly env: EnvPaths;

  constructor(
    queue: TaskQueue,
    logs: TaskLogManager | null,
    conf: Conf,
    hub: Hub,
    downloadSvc: DownloadTaskService | null,
    favoriteSvc: FavoriteService | null,
    conversionSvc: ConversionService | null,
    videoSvc: VideoService | null,
    env: EnvPaths,
  ) {
    this.queue = queue;
    this.logs = logs;
    this.conf = conf;
    this.hub = hub;
    this.downloadSvc = downloadSvc;
    this.favoriteSvc = favoriteSvc;
    this.conversionSvc = conversionSvc;
    this.videoSvc = videoSvc;
    this.env = env;
  }

  // ---- Health（/healthy）----

  health(c: Ctx): void {
    ok(c, { status: 'ok' }, 'OK');
  }

  // ---- Tasks（内存队列）----

  taskCreate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, 'invalid request body');
      return;
    }
    const id = typeof body.id === 'string' && body.id !== '' ? body.id : crypto.randomUUID();
    const type = body.type;
    const url = body.url;
    const name = body.name;
    if (typeof type !== 'string' || type === '' || typeof url !== 'string' || url === '' || typeof name !== 'string' || name === '') {
      fail(c, 400, 'Key: \'CreateTaskReq\' Error: required fields (type, url, name) missing');
      return;
    }
    const folder = typeof body.folder === 'string' ? body.folder : '';
    const headers = Array.isArray(body.headers) ? body.headers.map(String) : [];
    const status = this.queue.enqueue({ id, type: type as any, url, name, folder, headers });
    ok(c, { id, message: tLang(c.lang, MSG.TASK_ENQUEUED), status }, tLang(c.lang, MSG.TASK_CREATED));
  }

  taskGet(c: Ctx): void {
    const task = this.queue.getTask(c.params.id!);
    if (!task) {
      fail(c, 404, tLang(c.lang, MSG.TASK_NOT_FOUND));
      return;
    }
    ok(c, task);
  }

  taskList(c: Ctx): void {
    const tasks: TaskInfo[] = this.queue.getAllTasks();
    ok(c, { tasks, total: tasks.length });
  }

  taskStop(c: Ctx): void {
    try {
      this.queue.stop(c.params.id!);
    } catch (err: any) {
      fail(c, 404, err?.message ?? 'task not found');
      return;
    }
    const msg = tLang(c.lang, MSG.TASK_STOPPED);
    ok(c, { message: msg }, msg);
  }

  taskLogs(c: Ctx): void {
    if (!this.logs) {
      fail(c, 500, tLang(c.lang, MSG.TASK_LOG_NOT_CONFIGURED));
      return;
    }
    this.logs
      .read(c.params.id!)
      .then((content) => ok(c, { id: c.params.id, log: content }))
      .catch(() => fail(c, 404, tLang(c.lang, MSG.TASK_LOG_NOT_FOUND)));
  }

  // ---- Config ----

  configGetStore(c: Ctx): void {
    ok(c, this.conf.store());
  }

  configUpdate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, 'invalid request body');
      return;
    }
    this.conf
      .update(body)
      .then(() => {
        for (const [key, value] of Object.entries(body)) {
          this.hub.broadcast('config-changed', { key, value });
        }
        ok(c, { message: tLang(c.lang, MSG.CONFIG_UPDATED) }, tLang(c.lang, MSG.CONFIG_UPDATED));
      })
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  configGetKey(c: Ctx): void {
    ok(c, this.conf.get(c.params.key!));
  }

  configSetKey(c: Ctx): void {
    const body = asObject(c.body);
    const value = body ? body.value : undefined;
    this.conf
      .set(c.params.key!, value)
      .then(() => {
        this.hub.broadcast('config-changed', { key: c.params.key, value });
        ok(c, { message: tLang(c.lang, MSG.CONFIG_KEY_UPDATED, c.params.key) }, tLang(c.lang, MSG.CONFIG_UPDATED));
      })
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  // ---- Auth（统一身份：status 保留；setup/signin 已移除 → 路由层 404）----

  authStatus(c: Ctx): void {
    // 形状兼容 apps/ui / core-sdk：它们只读 data.setuped。
    // setuped 恒 true（mediago 不再有独立密码）；logged 反映门户会话是否有效。
    ok(c, { setuped: true, logged: isPortalSession(c.req) });
  }

  // ---- Utility ----

  urlTitle(c: Ctx): void {
    const url = c.url.searchParams.get('url');
    if (!url) {
      fail(c, 400, tLang(c.lang, MSG.URL_REQUIRED));
      return;
    }
    fetchPageTitle(url)
      .then((title) => ok(c, { data: title }))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  envPaths(c: Ctx): void {
    const forwardedHost = firstHeaderValue(c.req.headers['x-forwarded-host']);
    const forwardedProto = firstHeaderValue(c.req.headers['x-forwarded-proto']);
    const host = forwardedHost || c.req.headers.host || '';
    const scheme = forwardedProto || 'http';
    ok(c, { ...this.env, playerUrl: `${scheme}://${host}/player/` });
  }

  // ---- Events（SSE）----

  eventsStream(c: Ctx): void {
    const res = c.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    // 心跳注释行：连接空闲时保活。nginx 侧 proxy_read_timeout 虽有 3600s，
    // 但中间的反向代理/移动网络设备可能更短，没有心跳会被静默掐断。
    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        cleanup();
      }
    }, 15_000);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      this.hub.unsubscribe(client);
    };

    const client = (evt: { name: string; data: unknown }) => {
      res.write(`event: ${evt.name}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    };
    this.hub.subscribe(client);
    // 客户端断开：清理订阅与心跳，防止连接对象泄漏与对已断 socket 的写入
    c.req.on('close', cleanup);
    res.on('error', cleanup);
  }

  // ---- Downloads（DB 持久化主通道）----

  downloadCreate(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const body = asObject(c.body);
    if (!body || !Array.isArray(body.tasks) || body.tasks.length === 0) {
      fail(c, 400, 'Key: \'AddDownloadBatchReq.Tasks\' Error: tasks is required');
      return;
    }
    const inputs = body.tasks.map((t) => {
      const o = asObject(t) ?? {};
      return {
        name: typeof o.name === 'string' ? o.name : '',
        type: typeof o.type === 'string' ? o.type : '',
        url: typeof o.url === 'string' ? o.url : '',
        headers: typeof o.headers === 'string' ? o.headers : null,
        folder: typeof o.folder === 'string' ? o.folder : null,
      };
    });
    const startDownload = body.startDownload === true;

    this.downloadSvc
      .addDownloadTasks(inputs)
      .then(async (videos) => {
        if (startDownload) {
          const localPath = (this.conf.get('local') ?? '') as string;
          for (const v of videos) {
            try {
              await this.downloadSvc!.startDownload(v.id, localPath, false);
            } catch (err: any) {
              logger.warn(`auto-start download failed id=${v.id}: ${err?.message ?? err}`);
            }
          }
        }
        const ids = videos.map((v) => v.id);
        this.hub.broadcast('download-create', { ids, count: ids.length });
        ok(c, videos);
      })
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadList(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const current = queryNum(c, 'current', 0);
    const pageSize = queryNum(c, 'pageSize', 0);
    const filter = c.url.searchParams.get('filter') ?? '';
    const localPath = c.url.searchParams.get('localPath') ?? '';
    try {
      ok(c, this.downloadSvc.getDownloadTasks(current, pageSize, filter, localPath));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadGet(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      ok(c, this.downloadSvc.findByIdOrFail(id));
    } catch (err: any) {
      fail(c, 404, err?.message ?? String(err));
    }
  }

  downloadEdit(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, 'invalid request body');
      return;
    }
    const data: Record<string, unknown> = {};
    if ('name' in body) data.name = body.name;
    if ('url' in body) data.url = body.url;
    if ('headers' in body) data.headers = body.headers;
    if ('folder' in body) data.folder = body.folder;
    this.downloadSvc
      .editDownloadTask(id, data)
      .then((v) => ok(c, v))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadDelete(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.downloadSvc.deleteDownloadTask(id);
      ok(c, undefined, tLang(c.lang, MSG.DELETED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadStart(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, 'invalid request body');
      return;
    }
    const localPath = typeof body.localPath === 'string' ? body.localPath : '';
    const deleteSegments = body.deleteSegments === true;
    // 客户端提供的 localPath 同步进运行时配置（与 Go 一致）
    if (localPath !== '') {
      this.conf.set('local', localPath).catch((err: any) => {
        logger.warn(`Failed to sync localPath to config: ${err?.message ?? err}`);
      });
    }
    this.downloadSvc
      .startDownload(id, localPath, deleteSegments)
      .then(() => ok(c, undefined, tLang(c.lang, MSG.DOWNLOAD_STARTED)))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadStop(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.downloadSvc.stopDownload(id);
      ok(c, undefined, tLang(c.lang, MSG.DOWNLOAD_STOPPED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadLogs(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    this.downloadSvc
      .getDownloadLog(id)
      .then((content) => ok(c, { id, log: content }))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadFolders(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.downloadSvc.getTaskFolders());
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadExport(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.downloadSvc.exportDownloadList());
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadUpdateStatus(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const body = asObject(c.body);
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || typeof body.status !== 'string' || body.status === '') {
      fail(c, 400, 'Key: \'UpdateStatusReq\' Error: ids and status are required');
      return;
    }
    // 与 Go json 绑定 []int64 对齐：非整数 id 直接 400，而不是转成 NaN 打到 better-sqlite3 抛 500
    const ids: number[] = [];
    for (const raw of body.ids) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        fail(c, 400, 'Key: \'UpdateStatusReq.Ids\' Error: ids must be positive integers');
        return;
      }
      ids.push(n);
    }
    try {
      this.downloadSvc.setStatus(ids, body.status as string);
      ok(c, undefined, tLang(c.lang, MSG.STATUS_UPDATED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadUpdateIsLive(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, 'invalid request body');
      return;
    }
    try {
      ok(c, this.downloadSvc.setIsLive(id, body.isLive === true));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadActive(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.downloadSvc.findActiveTasks());
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  // ---- Favorites ----

  favoriteList(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.favoriteSvc.getFavorites());
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  favoriteCreate(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const body = asObject(c.body);
    if (!body || typeof body.url !== 'string' || body.url === '') {
      fail(c, 400, 'Key: \'AddFavoriteReq.URL\' Error: url is required');
      return;
    }
    const title = typeof body.title === 'string' && body.title !== '' ? body.title : (body.url as string);
    try {
      ok(c, this.favoriteSvc.addFavorite({ title, url: body.url as string, icon: typeof body.icon === 'string' ? body.icon : null }));
    } catch (err: any) {
      if (err?.name === 'URLAlreadyExistsError') {
        fail(c, 409, tLang(c.lang, MSG.URL_ALREADY_EXISTS));
        return;
      }
      fail(c, 500, err?.message ?? String(err));
    }
  }

  favoriteDelete(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.favoriteSvc.removeFavorite(id);
      ok(c, undefined, tLang(c.lang, MSG.DELETED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  favoriteExport(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.favoriteSvc.exportFavorites());
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  favoriteImport(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const body = asObject(c.body);
    if (!body || !Array.isArray(body.favorites) || body.favorites.length === 0) {
      fail(c, 400, 'Key: \'ImportFavoritesReq.Favorites\' Error: favorites is required');
      return;
    }
    const inputs = body.favorites.map((f) => {
      const o = asObject(f) ?? {};
      return {
        title: typeof o.title === 'string' ? o.title : '',
        url: typeof o.url === 'string' ? o.url : '',
        icon: typeof o.icon === 'string' ? o.icon : null,
      };
    });
    try {
      this.favoriteSvc.importFavorites(inputs);
      ok(c, undefined, tLang(c.lang, MSG.IMPORTED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  // ---- Conversions ----

  conversionList(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    try {
      ok(c, this.conversionSvc.getConversions(queryNum(c, 'current', 0), queryNum(c, 'pageSize', 0)));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  conversionCreate(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const body = asObject(c.body);
    if (!body || typeof body.path !== 'string' || body.path === '' || typeof body.outputFormat !== 'string' || body.outputFormat === '' || typeof body.quality !== 'string' || body.quality === '') {
      fail(c, 400, 'Key: \'AddConversionReq\' Error: path, outputFormat, quality are required');
      return;
    }
    try {
      ok(
        c,
        this.conversionSvc.addConversion({
          name: typeof body.name === 'string' ? body.name : null,
          path: body.path,
          outputFormat: body.outputFormat,
          quality: body.quality,
        }),
      );
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  conversionDelete(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.conversionSvc.deleteConversion(id);
      ok(c, undefined, tLang(c.lang, MSG.DELETED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  conversionGet(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      ok(c, this.conversionSvc.findByIdOrFail(id));
    } catch (err: any) {
      fail(c, 404, err?.message ?? String(err));
    }
  }

  conversionStart(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.conversionSvc.startConversion(id);
      ok(c, undefined);
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  conversionStop(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, 'database not configured');
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      this.conversionSvc.stopConversion(id);
      ok(c, undefined);
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  // ---- 播放器（/api/v1/videos —— 裸 JSON，不包 SuccessResponse）----

  videosList(c: Ctx): void {
    if (!this.videoSvc) {
      json(c, 500, { error: 'Failed to retrieve videos' });
      return;
    }
    json(c, 200, this.videoSvc.getVideoFiles());
  }

  videoGet(c: Ctx): void {
    if (!this.videoSvc) {
      json(c, 500, { error: 'Failed to retrieve videos' });
      return;
    }
    const id = intParam(c, 'id');
    if (id === null) {
      json(c, 400, { error: 'Invalid video ID' });
      return;
    }
    const video = this.videoSvc.getVideoByID(id);
    if (!video) {
      json(c, 404, { error: 'video file not found' });
      return;
    }
    json(c, 200, video);
  }
}

function firstHeaderValue(v: string | string[] | undefined): string {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return '';
  return raw.split(',')[0]!.trim();
}

/** 工具版抓标题（与 Go util.fetchTitle 一致：失败/无 title → download_<随机>） */
async function fetchPageTitle(url: string): Promise<string> {
  const { getPageTitle } = await import('../service/helpers.ts');
  const fallback = `download_${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}`;
  return getPageTitle(url, fallback);
}
