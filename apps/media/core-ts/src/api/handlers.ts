// api/handlers —— Go internal/api/handler/* 的复刻（各端点 1:1）

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../logger.ts";
import { MSG, tLang, type Lang } from "../i18n.ts";
import type { Conf } from "../conf.ts";
import type { TaskLogManager } from "../tasklog.ts";
import type { TaskQueue } from "../core/queue.ts";
import type { TaskInfo, Aria2RpcOptions } from "../core/types.ts";
import { extractTorrentMeta } from "../core/bencode.ts";
import type { Hub } from "./sse.ts";
import type { DownloadTaskService } from "../service/download.ts";
import type { FavoriteService } from "../service/favorite.ts";
import type { ConversionService } from "../service/conversion.ts";
import type { VideoService } from "./video.ts";
import { isPortalSession } from "./auth.ts";
import {
  btStagingRoot,
  normalizeAria2Options,
  normalizeAria2Rpc,
  type DownloaderSvc,
} from "../core/downloader.ts";
import { loadQBitConfig } from "../core/qbit.ts";

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
  json(c, 200, {
    success: true,
    code: 200,
    message: message ?? tLang(c.lang, MSG.OK),
    data,
  });
}

export function fail(c: Ctx, status: number, message: string): void {
  json(c, status, { success: false, code: status, message });
}

export function json(
  c: Ctx,
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
): void {
  const body = JSON.stringify(payload);
  c.res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  c.res.end(body);
}

function queryNum(c: Ctx, key: string, fallback = 0): number {
  const v = c.url.searchParams.get(key);
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function intParam(c: Ctx, key: string): number | null {
  const id = Number.parseInt(c.params[key]!, 10);
  return Number.isNaN(id) ? null : id;
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
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
  private readonly downloaderSvc: DownloaderSvc | null;

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
    downloaderSvc: DownloaderSvc | null = null,
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
    this.downloaderSvc = downloaderSvc;
  }

  // ---- Health（/healthy）----

  health(c: Ctx): void {
    ok(c, { status: "ok" }, "OK");
  }

  // ---- Tasks（内存队列）----

  taskCreate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
      return;
    }
    const id =
      typeof body.id === "string" && body.id !== ""
        ? body.id
        : crypto.randomUUID();
    const type = body.type;
    const url = body.url;
    const name = body.name;
    if (
      typeof type !== "string" ||
      type === "" ||
      typeof url !== "string" ||
      url === "" ||
      typeof name !== "string" ||
      name === ""
    ) {
      fail(
        c,
        400,
        "Key: 'CreateTaskReq' Error: required fields (type, url, name) missing",
      );
      return;
    }
    const folder = typeof body.folder === "string" ? body.folder : "";
    const headers = Array.isArray(body.headers) ? body.headers.map(String) : [];
    const status = this.queue.enqueue({
      id,
      type: type as any,
      url,
      name,
      folder,
      headers,
    });
    ok(
      c,
      { id, message: tLang(c.lang, MSG.TASK_ENQUEUED), status },
      tLang(c.lang, MSG.TASK_CREATED),
    );
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
      fail(c, 404, err?.message ?? "task not found");
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

  /** aria2 引擎设置写入前收敛（非法值回退默认）：存进 config.json 的就是生效值，
   *  回读与实际下载命令行注入保持一致（normalize 详见 core/downloader） */
  private sanitizeConfigValue(key: string, value: unknown): unknown {
    if (key === "aria2") {
      return normalizeAria2Options(value);
    }
    return value;
  }

  configGetStore(c: Ctx): void {
    ok(c, this.conf.store());
  }

  configUpdate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
      return;
    }
    for (const [key, value] of Object.entries(body)) {
      body[key] = this.sanitizeConfigValue(key, value);
    }
    this.conf
      .update(body)
      .then(() => {
        for (const [key, value] of Object.entries(body)) {
          this.hub.broadcast("config-changed", { key, value });
        }
        ok(
          c,
          { message: tLang(c.lang, MSG.CONFIG_UPDATED) },
          tLang(c.lang, MSG.CONFIG_UPDATED),
        );
      })
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  configGetKey(c: Ctx): void {
    ok(c, this.conf.get(c.params.key!));
  }

  configSetKey(c: Ctx): void {
    const body = asObject(c.body);
    const value = this.sanitizeConfigValue(
      c.params.key!,
      body ? body.value : undefined,
    );
    this.conf
      .set(c.params.key!, value)
      .then(() => {
        this.hub.broadcast("config-changed", { key: c.params.key, value });
        ok(
          c,
          { message: tLang(c.lang, MSG.CONFIG_KEY_UPDATED, c.params.key) },
          tLang(c.lang, MSG.CONFIG_UPDATED),
        );
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
    const url = c.url.searchParams.get("url");
    if (!url) {
      fail(c, 400, tLang(c.lang, MSG.URL_REQUIRED));
      return;
    }
    fetchPageTitle(url)
      .then((title) => ok(c, { data: title }))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  envPaths(c: Ctx): void {
    const forwardedHost = firstHeaderValue(c.req.headers["x-forwarded-host"]);
    const forwardedProto = firstHeaderValue(c.req.headers["x-forwarded-proto"]);
    const host = forwardedHost || c.req.headers.host || "";
    const scheme = forwardedProto || "http";
    ok(c, { ...this.env, playerUrl: `${scheme}://${host}/player/` });
  }

  // ---- Events（SSE）----

  eventsStream(c: Ctx): void {
    const res = c.res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    // 心跳注释行：连接空闲时保活。nginx 侧 proxy_read_timeout 虽有 3600s，
    // 但中间的反向代理/移动网络设备可能更短，没有心跳会被静默掐断。
    const heartbeat = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
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
    c.req.on("close", cleanup);
    res.on("error", cleanup);
  }

  // ---- Torrent 上传（种子文件模式）----

  /**
   * POST /api/upload/torrent  {data: <base64 的 .torrent 内容>}
   * 校验 bencode 并提取元数据，存 <configDir>/torrents/<sha1-16>.torrent。
   * 返回的 path 直接作 bt 任务 url（aria2c 原生支持种子文件路径）；
   * name/files 供 UI 预填任务名与内容勾选清单。
   */
  uploadTorrent(c: Ctx): void {
    const body = asObject(c.body);
    const data = typeof body?.data === "string" ? body.data : "";
    const buf = data !== "" ? Buffer.from(data, "base64") : Buffer.alloc(0);
    if (buf.length === 0) {
      fail(c, 400, "torrent data is required (base64)");
      return;
    }
    if (buf.length > 1024 * 1024) {
      fail(c, 400, "torrent file too large (max 1MB)");
      return;
    }
    let meta;
    try {
      meta = extractTorrentMeta(buf);
    } catch (err: any) {
      fail(c, 400, `invalid torrent file: ${err?.message ?? err}`);
      return;
    }
    const torrentsDir = path.join(this.env.configDir, "torrents");
    fs.mkdirSync(torrentsDir, { recursive: true });
    const hash = crypto
      .createHash("sha1")
      .update(buf)
      .digest("hex")
      .slice(0, 16);
    const filePath = path.join(torrentsDir, `${hash}.torrent`);
    fs.writeFileSync(filePath, buf);
    ok(c, {
      path: filePath,
      name: meta.name,
      size: meta.size,
      files: meta.files,
    });
  }

  // ---- Downloads（DB 持久化主通道）----

  /**
   * 磁力链接内容解析（任务创建前的强制内容识别，对齐迅雷）：
   * qBittorrent 引擎 add 到解析暂存目录抓 metadata（libtorrent 常驻温热
   * DHT，秒级）→ stop → 返回种子真名/总大小/文件清单。任务 url 用磁力原文，
   * 提交时按 hash 续用暂存种子迁移到任务目录。existed/completed 标识引擎
   * 中已有该资源（UI 提示续传 / 重新下载）。
   */
  resolveMagnet(c: Ctx): void {
    const body = asObject(c.body);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!/^magnet:\?.+urn:btih:[0-9a-fA-F]{40}/.test(url)) {
      fail(c, 400, "invalid magnet link (magnet:?xt=urn:btih:<40-hex>)");
      return;
    }
    if (!this.downloaderSvc) {
      fail(c, 500, "downloader not configured");
      return;
    }
    const stagingRoot = btStagingRoot(this.env.configDir);
    this.downloaderSvc
      .resolveMagnetBt(url, stagingRoot)
      .then((r) =>
        ok(c, {
          hash: r.hash,
          name: r.name,
          size: r.size,
          files: r.files,
          existed: r.existed,
          completed: r.completed,
        }),
      )
      .catch((err: any) => {
        if (err?.name === "QBitUnavailableError") {
          fail(c, 503, err?.message ?? "BT 引擎不可用");
          return;
        }
        const msg = String(err?.message ?? err ?? "magnet resolve failed");
        // 存储类异常是引擎自身故障而非资源失效——语义化报错，避免 UI
        // 把 ENOENT/EACCES 之类的原始系统错误配进「磁力已失效」引导
        if (/^(ENOENT|EACCES|EPERM|ENOSPC|EROFS)\b/.test(msg)) {
          fail(
            c,
            500,
            `下载中心引擎存储异常（${msg.split(",")[0]}），请检查 /data 挂载与磁盘空间后重试`,
          );
          return;
        }
        fail(c, 400, msg);
      });
  }

  /**
   * 弃置解析暂存种子（表单取消/关闭时 UI 调用）：只删解析暂存目录内的
   * 种子（save_path 前缀校验，防误删用户在 qB 的正式任务），连暂存半成品
   * 文件一起清。
   */
  discardMagnet(c: Ctx): void {
    const body = asObject(c.body);
    const hash =
      typeof body?.hash === "string" ? body.hash.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(hash)) {
      fail(c, 400, "invalid torrent hash (40-hex)");
      return;
    }
    if (!this.downloaderSvc) {
      fail(c, 500, "downloader not configured");
      return;
    }
    const stagingRoot = btStagingRoot(this.env.configDir);
    const qbit = this.downloaderSvc.qbit();
    qbit
      .getInfo(hash)
      .then(async (list) => {
        const t = list[0];
        // 不在引擎 / 不在解析暂存目录（用户自己的 qB 任务）：不动
        if (t && t.save_path.startsWith(stagingRoot)) {
          await qbit.deleteTorrent(hash, true);
          logger.info(`discarded magnet staging torrent: ${hash}`);
        }
        ok(c, { hash });
      })
      .catch((err: any) => fail(c, 400, err?.message ?? "discard failed"));
  }

  /**
   * 下载引擎接入信息（设置页「下载引擎」展示）：
   * - aria2 RPC：对外通用引擎（完整 aria2 能力），第三方客户端
   *   （AriaNg / 手机 App / 浏览器扩展）填 RPC 地址 + secret 即可接入控制；
   *   第三方提交的任务直接落下载根（/downloads）
   * - qbittorrent：BT 下载中心引擎 + 独立 Web UI（浏览器直接管理 BT），
   *   宿主访问端口经 compose 映射（env 声明）
   */
  getEngines(c: Ctx): void {
    if (!this.downloaderSvc) {
      fail(c, 500, "downloader not configured");
      return;
    }
    const rpc = normalizeAria2Rpc(this.conf.get("aria2Rpc"));
    const qbitCfg = loadQBitConfig(
      process.env.MEI_QBIT_BASEURL ?? "http://127.0.0.1:8080",
    );
    // 宿主侧访问端口（compose 映射声明；容器内固定 6800/8080）
    const aria2HostPort = Number.parseInt(
      process.env.MEI_ARIA2_RPC_PORT ?? "6800",
      10,
    );
    const qbitHostPort = Number.parseInt(
      process.env.MEI_QBIT_WEBUI_PORT ?? "8080",
      10,
    );
    const qbit = this.downloaderSvc.qbit();
    qbit
      .version()
      .then((version) => {
        ok(c, {
          aria2Rpc: {
            enabled: rpc.enabled,
            port: aria2HostPort,
            secret: rpc.secret,
            rpcPath: "/jsonrpc",
            alive: this.downloaderSvc!.aria2RpcAlive(),
          },
          qbittorrent: {
            port: qbitHostPort,
            username: qbitCfg.username,
            password: qbitCfg.password,
            version,
          },
        });
      })
      .catch((err: any) => {
        ok(c, {
          aria2Rpc: {
            enabled: rpc.enabled,
            port: aria2HostPort,
            secret: rpc.secret,
            rpcPath: "/jsonrpc",
            alive: this.downloaderSvc!.aria2RpcAlive(),
          },
          qbittorrent: {
            port: qbitHostPort,
            username: qbitCfg.username,
            password: qbitCfg.password,
            version: "",
            error: err?.message ?? "BT 引擎不可达",
          },
        });
      });
  }

  /**
   * aria2 RPC 对外引擎配置更新（设置页）：
   * enabled / port 即时生效（server onDidChange('aria2Rpc') 重启守护），
   * resetSecret 重置接入凭证（旧客户端全部失效）。
   */
  setAria2Rpc(c: Ctx): void {
    const body = asObject(c.body);
    const cur = normalizeAria2Rpc(this.conf.get("aria2Rpc"));
    if (body === null) {
      fail(c, 400, "body required");
      return;
    }
    const next: Aria2RpcOptions = { ...cur };
    if (typeof body.enabled === "boolean") next.enabled = body.enabled;
    if (body.port !== undefined) {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        fail(c, 400, "port must be 1024-65535");
        return;
      }
      next.port = port;
    }
    if (body.resetSecret === true) next.secret = crypto.randomUUID();
    void this.conf.set("aria2Rpc", next); // onDidChange 触发守护重启
    ok(c, { ...next });
  }

  downloadCreate(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const body = asObject(c.body);
    if (!body || !Array.isArray(body.tasks) || body.tasks.length === 0) {
      fail(c, 400, "Key: 'AddDownloadBatchReq.Tasks' Error: tasks is required");
      return;
    }
    const torrentsDir = path.join(this.env.configDir, "torrents");
    let inputs: Array<{
      name: string;
      type: string;
      url: string;
      headers: string | null;
      folder: string | null;
      selectFile: string | null;
    }>;
    try {
      inputs = body.tasks.map((t, i) => {
        const o = asObject(t) ?? {};
        const type = typeof o.type === "string" ? o.type : "";
        const url = typeof o.url === "string" ? o.url : "";
        // BT 种子文件模式：url 是本地 .torrent 路径，只允许指向上传目录
        //（防止借任务读/写任意本地文件路径）
        if (
          type === "bt" &&
          url !== "" &&
          !url.startsWith("magnet:") &&
          /\.torrent$/i.test(url)
        ) {
          const resolved = path.resolve(url);
          if (!resolved.startsWith(path.resolve(torrentsDir) + path.sep)) {
            throw new Error(
              `tasks[${i}].url: torrent file must be uploaded via /api/upload/torrent`,
            );
          }
        }
        return {
          name: typeof o.name === "string" ? o.name : "",
          type,
          url,
          headers: typeof o.headers === "string" ? o.headers : null,
          folder: typeof o.folder === "string" ? o.folder : null,
          selectFile:
            typeof o.selectFile === "string" && o.selectFile.trim() !== ""
              ? o.selectFile.trim()
              : null,
        };
      });
    } catch (err: any) {
      fail(c, 400, err?.message ?? String(err));
      return;
    }
    const startDownload = body.startDownload === true;

    this.downloadSvc
      .addDownloadTasks(inputs)
      .then(async (videos) => {
        if (startDownload) {
          const localPath = (this.conf.get("local") ?? "") as string;
          for (const v of videos) {
            try {
              await this.downloadSvc!.startDownload(v.id, localPath, false);
            } catch (err: any) {
              logger.warn(
                `auto-start download failed id=${v.id}: ${err?.message ?? err}`,
              );
            }
          }
        }
        const ids = videos.map((v) => v.id);
        this.hub.broadcast("download-create", { ids, count: ids.length });
        ok(c, videos);
      })
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadList(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const current = queryNum(c, "current", 0);
    const pageSize = queryNum(c, "pageSize", 0);
    const filter = c.url.searchParams.get("filter") ?? "";
    const localPath = c.url.searchParams.get("localPath") ?? "";
    // 任务类型过滤（direct/bt/media），下载中心文件/磁力/媒体 tab 用
    const taskType = c.url.searchParams.get("type") ?? "";
    try {
      ok(
        c,
        this.downloadSvc.getDownloadTasks(
          current,
          pageSize,
          filter,
          localPath,
          taskType,
        ),
      );
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadGet(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
      return;
    }
    const data: Record<string, unknown> = {};
    if ("name" in body) data.name = body.name;
    if ("url" in body) data.url = body.url;
    if ("headers" in body) data.headers = body.headers;
    if ("folder" in body) data.folder = body.folder;
    this.downloadSvc
      .editDownloadTask(id, data)
      .then((v) => ok(c, v))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadDelete(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    try {
      // deleteFiles=1：同时清理落盘文件（成品 + 下载器输出目录 + 分片临时）。
      // 未完成任务总是停队列；文件清理是尽力而为，缺失不阻断记录删除
      const deleteFilesQuery = c.url.searchParams.get("deleteFiles");
      const deleteFiles =
        deleteFilesQuery === "1" || deleteFilesQuery === "true";
      const localPath = this.conf ? String(this.conf.get("local") ?? "") : "";
      this.downloadSvc.deleteDownloadTask(id, { deleteFiles, localPath });
      ok(c, undefined, tLang(c.lang, MSG.DELETED));
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  downloadStart(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
      return;
    }
    const localPath = typeof body.localPath === "string" ? body.localPath : "";
    const deleteSegments = body.deleteSegments === true;
    // 客户端提供的 localPath 同步进运行时配置（与 Go 一致）
    if (localPath !== "") {
      this.conf.set("local", localPath).catch((err: any) => {
        logger.warn(
          `Failed to sync localPath to config: ${err?.message ?? err}`,
        );
      });
    }
    this.downloadSvc
      .startDownload(id, localPath, deleteSegments)
      .then(() => ok(c, undefined, tLang(c.lang, MSG.DOWNLOAD_STARTED)))
      .catch((err: any) => fail(c, 500, err?.message ?? String(err)));
  }

  downloadStop(c: Ctx): void {
    if (!this.downloadSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
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
      fail(c, 500, "database not configured");
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
      fail(c, 500, "database not configured");
      return;
    }
    const body = asObject(c.body);
    if (
      !body ||
      !Array.isArray(body.ids) ||
      body.ids.length === 0 ||
      typeof body.status !== "string" ||
      body.status === ""
    ) {
      fail(c, 400, "Key: 'UpdateStatusReq' Error: ids and status are required");
      return;
    }
    // 与 Go json 绑定 []int64 对齐：非整数 id 直接 400，而不是转成 NaN 打到 better-sqlite3 抛 500
    const ids: number[] = [];
    for (const raw of body.ids) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        fail(
          c,
          400,
          "Key: 'UpdateStatusReq.Ids' Error: ids must be positive integers",
        );
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, tLang(c.lang, MSG.INVALID_ID));
      return;
    }
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
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
      fail(c, 500, "database not configured");
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
      fail(c, 500, "database not configured");
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
      fail(c, 500, "database not configured");
      return;
    }
    const body = asObject(c.body);
    if (!body || typeof body.url !== "string" || body.url === "") {
      fail(c, 400, "Key: 'AddFavoriteReq.URL' Error: url is required");
      return;
    }
    const title =
      typeof body.title === "string" && body.title !== ""
        ? body.title
        : (body.url as string);
    try {
      ok(
        c,
        this.favoriteSvc.addFavorite({
          title,
          url: body.url as string,
          icon: typeof body.icon === "string" ? body.icon : null,
        }),
      );
    } catch (err: any) {
      if (err?.name === "URLAlreadyExistsError") {
        fail(c, 409, tLang(c.lang, MSG.URL_ALREADY_EXISTS));
        return;
      }
      fail(c, 500, err?.message ?? String(err));
    }
  }

  favoriteDelete(c: Ctx): void {
    if (!this.favoriteSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
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
      fail(c, 500, "database not configured");
      return;
    }
    const body = asObject(c.body);
    if (
      !body ||
      !Array.isArray(body.favorites) ||
      body.favorites.length === 0
    ) {
      fail(
        c,
        400,
        "Key: 'ImportFavoritesReq.Favorites' Error: favorites is required",
      );
      return;
    }
    const inputs = body.favorites.map((f) => {
      const o = asObject(f) ?? {};
      return {
        title: typeof o.title === "string" ? o.title : "",
        url: typeof o.url === "string" ? o.url : "",
        icon: typeof o.icon === "string" ? o.icon : null,
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
      fail(c, 500, "database not configured");
      return;
    }
    try {
      ok(
        c,
        this.conversionSvc.getConversions(
          queryNum(c, "current", 0),
          queryNum(c, "pageSize", 0),
        ),
      );
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  conversionCreate(c: Ctx): void {
    if (!this.conversionSvc) {
      fail(c, 500, "database not configured");
      return;
    }
    const body = asObject(c.body);
    if (
      !body ||
      typeof body.path !== "string" ||
      body.path === "" ||
      typeof body.outputFormat !== "string" ||
      body.outputFormat === "" ||
      typeof body.quality !== "string" ||
      body.quality === ""
    ) {
      fail(
        c,
        400,
        "Key: 'AddConversionReq' Error: path, outputFormat, quality are required",
      );
      return;
    }
    try {
      ok(
        c,
        this.conversionSvc.addConversion({
          name: typeof body.name === "string" ? body.name : null,
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      fail(c, 500, "database not configured");
      return;
    }
    const id = intParam(c, "id");
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
      json(c, 500, { error: "Failed to retrieve videos" });
      return;
    }
    json(c, 200, this.videoSvc.getVideoFiles());
  }

  videoGet(c: Ctx): void {
    if (!this.videoSvc) {
      json(c, 500, { error: "Failed to retrieve videos" });
      return;
    }
    const id = intParam(c, "id");
    if (id === null) {
      json(c, 400, { error: "Invalid video ID" });
      return;
    }
    const video = this.videoSvc.getVideoByID(id);
    if (!video) {
      json(c, 404, { error: "video file not found" });
      return;
    }
    json(c, 200, video);
  }
}

function firstHeaderValue(v: string | string[] | undefined): string {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return "";
  return raw.split(",")[0]!.trim();
}

/** 工具版抓标题（与 Go util.fetchTitle 一致：失败/无 title → download_<随机>） */
async function fetchPageTitle(url: string): Promise<string> {
  const { getPageTitle } = await import("../service/helpers.ts");
  const fallback = `download_${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}`;
  return getPageTitle(url, fallback);
}
