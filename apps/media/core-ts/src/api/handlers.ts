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
import type { TaskInfo } from "../core/types.ts";
import { extractTorrentMeta } from "../core/bencode.ts";
import type { Hub } from "./sse.ts";
import type { DownloadTaskService } from "../service/download.ts";
import type { FavoriteService } from "../service/favorite.ts";
import type { ConversionService } from "../service/conversion.ts";
import type { VideoService } from "./video.ts";
import { isPortalSession } from "./auth.ts";
import type { EngineBridge } from "../service/engine.ts";
import { FluxDownUnavailableError } from "../core/fluxdown.ts";
import type { DownloaderSvc } from "../core/downloader.ts";

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
  private readonly engine: EngineBridge | null;

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
    engine: EngineBridge | null = null,
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
    this.engine = engine;
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

  configGetStore(c: Ctx): void {
    ok(c, this.conf.store());
  }

  configUpdate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body) {
      fail(c, 400, "invalid request body");
      return;
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
    const value = body ? body.value : undefined;
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
   * FluxDown 引擎建解析会话（itorrents 网关有档则种子直供秒出元数据，
   * 否则磁力原文走 DHT）→ 文件清单就绪挂起等用户勾选（60s 引擎侧期限）。
   * 提交时接管会话应答选择；取消经 discard-magnet。
   * existed/completed 标识已在本下载中心存在（活动任务直接接管）。
   */
  resolveMagnet(c: Ctx): void {
    const body = asObject(c.body);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const folder = typeof body?.folder === "string" ? body.folder : null;
    if (!/^magnet:\?.+urn:btih:[0-9a-fA-F]{40}/.test(url)) {
      fail(c, 400, "invalid magnet link (magnet:?xt=urn:btih:<40-hex>)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .resolveMagnet(url, folder)
      .then((r) =>
        ok(c, {
          hash: r.hash,
          name: r.name,
          size: r.size,
          files: r.files,
          existed: r.existed,
          completed: r.completed,
          engineTaskId: r.engineTaskId ?? "",
          folderLocked: r.folderLocked ?? false,
          folder: r.folder ?? "",
          existedId: r.existedId ?? 0,
        }),
      )
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, String(err?.message ?? err ?? "magnet resolve failed"));
      });
  }

  /**
   * 弃置解析会话（表单取消/关闭时 UI 调用）：删引擎里的解析任务
   * （挂起中无产物；已超期开始下载的会话连半成品一起清）。
   */
  discardMagnet(c: Ctx): void {
    const body = asObject(c.body);
    const hash =
      typeof body?.hash === "string" ? body.hash.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(hash)) {
      fail(c, 400, "invalid torrent hash (40-hex)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .discardResolve(hash)
      .then(() => ok(c, { hash }))
      .catch((err: any) => fail(c, 400, err?.message ?? "discard failed"));
  }

  /**
   * 下载引擎接入信息（设置页「下载引擎」展示）：
   * FluxDown 单引擎三口：REST/官方 Web 控制台/aria2 兼容 JSON-RPC 共用
   * 17800（容器内），宿主接入端口经 compose 映射（env 声明）——aria2 兼容
   * RPC 供第三方客户端（AriaNg / 手机 App / 浏览器扩展）接入控制；控制台
   * 提供任务详情/队列/RSS/插件/诊断等完整管理界面。
   */
  getEngines(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    const token = this.engineToken();
    const rpcHostPort = Number.parseInt(
      process.env.MEI_FLUXDOWN_RPC_PORT ??
        process.env.MEI_ARIA2_RPC_PORT ?? // 旧名兼容（部署 env 未更新时回落）
        "7778",
      10,
    );
    const webHostPort = Number.parseInt(
      process.env.MEI_FLUXDOWN_WEB_PORT ??
        process.env.MEI_QBIT_WEBUI_PORT ?? // 旧名兼容（部署 env 未更新时回落）
        "7779",
      10,
    );
    this.engine
      .fdVersion()
      .then((version) => {
        ok(c, {
          fluxdown: {
            version,
            ready: true,
            token,
            rpc: {
              hostPort: rpcHostPort,
              rpcPath: "/jsonrpc",
              protocol: "aria2 兼容 JSON-RPC 2.0",
            },
            web: {
              hostPort: webHostPort,
              path: "/",
            },
          },
        });
      })
      .catch((err: any) => {
        ok(c, {
          fluxdown: {
            version: "",
            ready: false,
            token,
            error: err?.message ?? "下载引擎不可达",
            rpc: { hostPort: rpcHostPort, rpcPath: "/jsonrpc" },
            web: { hostPort: webHostPort, path: "/" },
          },
        });
      });
  }

  /** 引擎访问密钥（设置页展示；来源与 core 连接一致） */
  private engineToken(): string {
    return process.env.FLUXDOWN_TOKEN ?? "";
  }

  /**
   * 引擎配置查询（设置页「下载引擎」→ FluxDown 卡）：
   * BT（DHT/UPnP/端口区间/MSE/自定义 tracker/tracker 订阅/做种策略）、
   * 全局限速、并发、文件冲突策略等 —— 引擎为唯一事实源（revision 乐观锁）。
   */
  engineConfigGet(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .configGet()
      .then((snap) => ok(c, { revision: snap.revision, values: snap.values }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "engine config query failed");
      });
  }

  /** 引擎配置更新（设置页表单提交；revision 乐观锁在引擎侧校验） */
  engineConfigPatch(c: Ctx): void {
    const body = asObject(c.body);
    if (!body || typeof body.values !== "object" || body.values === null) {
      fail(c, 400, "values required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    // 白名单：只允许下载中心语义内的键（对齐 daemon DAEMON_CONFIG_FIELDS
    // ——未知键整单拒绝 UnknownField），防越权改写引擎的代理/凭据等
    // 非下载中心管辖配置
    const allowed = [
      // 通用下载
      "speed_limit_bytes",
      "upload_limit_bytes",
      "max_concurrent_tasks",
      "default_segments",
      "auto_max_connections",
      "max_auto_retries",
      "auto_retry_delay_secs",
      "dedup_same_url",
      "auto_resume_on_start",
      "file_exists_behavior",
      "file_missing_action",
      // BT
      "bt_enable_dht",
      "bt_enable_upnp",
      "bt_port_start",
      "bt_port_end",
      "bt_mse_mode",
      "bt_custom_trackers",
      "bt_tracker_sub_enabled",
      "bt_tracker_sub_urls",
      "bt_seed_enabled",
      "bt_auto_reseed",
      "bt_seed_max_active",
      "bt_seed_ratio_limit",
      "bt_seed_post_ratio_limit",
      "bt_seed_time_limit_minutes",
      "bt_seed_time_limit_unit",
      "bt_seed_inactive_time_limit_minutes",
      "bt_seed_inactive_time_limit_unit",
      "bt_seed_limit_operator",
      "bt_seed_then_action",
      // eD2K（direct 类型 ed2k:// 链接的找源网络）
      "ed2k_enable_kad",
      "ed2k_enable_upnp",
      "ed2k_listen_port",
      "ed2k_server_list",
      "ed2k_server_sub_enabled",
      "ed2k_server_sub_urls",
    ];
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
      if (allowed.includes(k)) values[k] = String(v);
    }
    if (Object.keys(values).length === 0) {
      fail(c, 400, "no configurable keys in values");
      return;
    }
    this.engine
      .configPatch(values)
      .then((snap) => ok(c, { revision: snap.revision, values: snap.values }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "engine config update failed");
      });
  }

  /** tracker 订阅立即刷新（ngosang/trackerslist 等订阅源拉最新清单） */
  engineTrackerRefresh(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .trackerSubscriptionRefresh()
      .then((r) => ok(c, r))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "tracker refresh failed");
      });
  }

  /** 引擎任务改名（任务行操作；引擎侧校验状态与非法字符） */
  taskRename(c: Ctx): void {
    const id = intParam(c, "id");
    const body = asObject(c.body);
    const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
    if (id === null) {
      fail(c, 400, "invalid task id");
      return;
    }
    if (fileName === "" || /[\\/:*?"<>|]/.test(fileName)) {
      fail(c, 400, "fileName required (no path separators)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rename(id, fileName)
      .then(() => {
        // DB 同步改名（列表立即生效；引擎事件侧亦会镜像校准）
        try {
          this.downloadSvc?.editDownloadTask(id, { name: fileName });
        } catch {
          // DB 行可能已被删除：引擎侧已生效即可
        }
        ok(c, { id, fileName });
      })
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rename failed");
      });
  }

  /** 引擎任务换源（任务行操作：换镜像/备用地址续传） */
  taskChangeUrl(c: Ctx): void {
    const id = intParam(c, "id");
    const body = asObject(c.body);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (id === null) {
      fail(c, 400, "invalid task id");
      return;
    }
    if (!/^https?:\/\//.test(url)) {
      fail(c, 400, "url must be http(s)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .changeUrl(id, url)
      .then(() => {
        try {
          this.downloadSvc?.editDownloadTask(id, { url });
        } catch {
          // DB 行可能已被删除
        }
        ok(c, { id, url });
      })
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "change url failed");
      });
  }

  /** 引擎任务详情（任务详情抽屉：任务快照 + 活动日志 + 实时数据） */
  engineTaskDetail(c: Ctx): void {
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, "invalid task id");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    Promise.all([
      this.engine.taskInfo(id),
      this.engine
        .taskActivity(id)
        .then((entries) => entries.slice(-200))
        .catch(() => []),
    ])
      .then(([task, activity]) => {
        const extras = this.engine!.detailExtras(id);
        ok(c, {
          task,
          activity,
          runtime: this.engine!.runtimeOf(id) ?? null,
          segments: extras.segments,
          speedHistory: extras.speedHistory,
        });
      })
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "task detail failed");
      });
  }

  /** 引擎产物文件跟踪重扫（fileMissing 全量盘点；文件被外部移动/删除后找回） */
  engineRescan(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rescanFiles()
      .then(() => ok(c, { message: "rescan completed" }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rescan failed");
      });
  }

  /** 每任务做种限制覆盖（详情抽屉「做种设置」） */
  engineSeedLimits(c: Ctx): void {
    const id = intParam(c, "id");
    if (id === null) {
      fail(c, 400, "invalid task id");
      return;
    }
    const body = asObject(c.body) ?? {};
    const num = (key: string): number | null => {
      const v = body[key];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    // qB 三态：-2 跟随全局 / -1 不限 / >=0 自定义（分享率千分比）
    const clamp = (v: number | null, min: number): number =>
      v === null ? -2 : Math.max(min, Math.round(v));
    const limits = {
      ratioLimitMilli: clamp(num("ratioLimitMilli"), 0),
      postRatioLimitMilli: clamp(num("postRatioLimitMilli"), 0),
      seedTimeLimitMinutes: clamp(num("seedTimeLimitMinutes"), 0),
      inactiveTimeLimitMinutes: clamp(num("inactiveTimeLimitMinutes"), 0),
      uploadLimitBps: clamp(num("uploadLimitBps"), 0),
    };
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .setSeedLimits(id, limits)
      .then(() => ok(c, { message: "seed limits updated" }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "seed limits update failed");
      });
  }

  /** 引擎任务批量操作（UI 全部暂停/开始；action: pause|resume） */
  engineBatch(c: Ctx): void {
    const body = asObject(c.body) ?? {};
    // action 扩展：pause/resume（按 ids 或全量 all —— 对齐控制台
    // 「全部暂停/全部恢复」原生口）
    const action = body.action === "resume" ? "resume" : "pause";
    const isAll = body.all === true;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v) => typeof v === "number" && Number.isInteger(v))
      : [];
    if (!isAll && ids.length === 0) {
      fail(c, 400, "ids required (or all=true)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    const op =
      isAll
        ? action === "pause"
          ? this.engine.pauseAllEngine()
          : this.engine.resumeAllEngine()
        : action === "pause"
          ? this.engine.pauseMany(ids as number[])
          : this.engine.resumeMany(ids as number[]);
    op
      .then(() => ok(c, { message: `engine tasks ${action}d` }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "engine batch failed");
      });
  }

  /** 目录浏览（新建下载「保存目录」；引擎 fs.list,限 /downloads 子树） */
  engineFsList(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    const raw = c.url.searchParams.get("path") ?? "/downloads";
    if (raw !== "/downloads" && !raw.startsWith("/downloads/")) {
      fail(c, 400, "仅支持浏览 /downloads 目录树");
      return;
    }
    this.engine
      .fsList(raw)
      .then((r) => ok(c, r))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "fs list failed");
      });
  }

  /** 保存目录浏览器内新建目录（core 直写；限 /downloads 子树、单段目录名） */
  engineFsMkdir(c: Ctx): void {
    const body = asObject(c.body);
    const raw = typeof body?.path === "string" ? body.path.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (raw !== "/downloads" && !raw.startsWith("/downloads/")) {
      fail(c, 400, "仅支持在 /downloads 目录树内新建目录");
      return;
    }
    if (
      name === "" ||
      name.length > 64 ||
      name.includes("/") ||
      name.includes("\\") ||
      name === "." ||
      name === ".."
    ) {
      fail(c, 400, "目录名不合法（单段名称，不含分隔符）");
      return;
    }
    try {
      const target = path.join(raw, name);
      if (fs.existsSync(target)) {
        ok(c, { path: target, existed: true });
        return;
      }
      fs.mkdirSync(target, { recursive: true });
      ok(c, { path: target });
    } catch (err: any) {
      fail(c, 500, err?.message ?? String(err));
    }
  }

  /** 引擎全局运行统计（下载页头部：总速度/活跃任务/磁盘剩余） */
  engineStats(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .runtimeStatsGet()
      .then((stats) => ok(c, stats ?? { activeTasks: 0, pendingTasks: 0, totalDownloadBps: 0, totalUploadBps: 0, diskFreeBytes: null, saveDir: "" }))
      .catch((err: any) => fail(c, 400, err?.message ?? "engine stats failed"));
  }

  // ---- 命名队列（daemon.queue.* 代理；0.5.4：schedule/reorder 无效不接入）----

  /** 队列清单（含内置 main/later） */
  engineQueuesList(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueList()
      .then((queues) => ok(c, queues))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue list failed");
      });
  }

  /** 建队列（新 queueId 需回列表取） */
  engineQueueCreate(c: Ctx): void {
    const body = asObject(c.body) ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      fail(c, 400, "queue name is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueCreate(name)
      .then((r) => ok(c, { created: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue create failed");
      });
  }

  /** 队列改名（0.5.4 唯一可用的更新面） */
  engineQueueUpdate(c: Ctx): void {
    const body = asObject(c.body) ?? {};
    const queueId = typeof body.queueId === "string" ? body.queueId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (queueId === "" || name === "") {
      fail(c, 400, "queueId and name are required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueUpdate(queueId, name)
      .then((r) => ok(c, { updated: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue update failed");
      });
  }

  /** 删队列（内置 main/later 由引擎拒绝；队列内任务由引擎处置——core 不级联删任务） */
  engineQueueDelete(c: Ctx): void {
    const queueId = c.params.queueId ?? "";
    if (queueId === "") {
      fail(c, 400, "queueId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueDelete(queueId)
      .then((r) => ok(c, { deleted: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue delete failed");
      });
  }

  /** 恢复队列调度 */
  engineQueueStart(c: Ctx): void {
    this.queueUnitOp(c, (engine, queueId) => engine.queueStart(queueId));
  }

  /** 暂停队列调度（在途任务继续，新任务排队） */
  engineQueueStop(c: Ctx): void {
    this.queueUnitOp(c, (engine, queueId) => engine.queueStop(queueId));
  }

  private queueUnitOp(
    c: Ctx,
    op: (engine: NonNullable<Handlers["engine"]>, queueId: string) => Promise<{ ok: boolean }>,
  ): void {
    const queueId = c.params.queueId ?? "";
    if (queueId === "") {
      fail(c, 400, "queueId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    op(this.engine, queueId)
      .then((r) => ok(c, { ok: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue op failed");
      });
  }

  /** 把任务（DB id → 引擎任务）挪入指定队列 */
  engineTaskQueueMove(c: Ctx): void {
    const id = Number.parseInt(c.params.id ?? "", 10);
    const body = asObject(c.body) ?? {};
    const queueId = typeof body.queueId === "string" ? body.queueId.trim() : "";
    if (Number.isNaN(id) || queueId === "") {
      fail(c, 400, "id and queueId are required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueMoveTaskForDb(id, queueId)
      .then((r) => ok(c, { moved: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue move failed");
      });
  }

  /** 任务插队（队列内提到队首优先调度） */
  engineTaskQueueBoost(c: Ctx): void {
    const id = Number.parseInt(c.params.id ?? "", 10);
    if (Number.isNaN(id)) {
      fail(c, 400, "invalid task id");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .queueBoostForDb(id)
      .then((r) => ok(c, { boosted: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "queue boost failed");
      });
  }

  /** eD2K 服务器列表订阅刷新（设置页引擎 tab） */
  engineEd2kRefresh(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .ed2kSubscriptionRefresh()
      .then((r) => ok(c, r))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "ed2k subscription refresh failed");
      });
  }

  // ---- RSS 订阅（daemon.rss.* 代理；订阅源 CRUD / 条目 / 校验 / 刷新）----

  /** RSS 写字段的白名单抽取（源 DTO 全字段；未知键丢弃） */
  private rssSourceBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const str = (k: string): string | undefined =>
      typeof body[k] === "string" ? (body[k] as string) : undefined;
    const num = (k: string): number | undefined =>
      typeof body[k] === "number" && Number.isFinite(body[k] as number)
        ? (body[k] as number)
        : undefined;
    const bool = (k: string): boolean | undefined =>
      typeof body[k] === "boolean" ? (body[k] as boolean) : undefined;
    const out: Record<string, unknown> = {};
    const strs = [
      "sourceId",
      "url",
      "name",
      "queueId",
      "saveDir",
      "includePattern",
      "excludePattern",
      "cookies",
      "userAgent",
      "proxyUrl",
    ];
    for (const k of strs) {
      const v = str(k);
      if (v !== undefined) out[k] = v;
    }
    for (const k of [
      "intervalMinutes",
      "sizeMinBytes",
      "sizeMaxBytes",
      "maxPerFetch",
    ] as const) {
      const v = num(k);
      if (v !== undefined) out[k] = Math.max(0, Math.round(v));
    }
    for (const k of [
      "enabled",
      "autoDownload",
      "startPaused",
      "useRegex",
      "smartEpisode",
      "sendReferer",
      "notifyOnDownload",
    ] as const) {
      const v = bool(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  rssSourcesList(c: Ctx): void {
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssListSources()
      .then((sources) => ok(c, sources))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss sources query failed");
      });
  }

  rssSourceCreate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body || typeof body.url !== "string" || body.url === "") {
      fail(c, 400, "url is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssCreateSource(this.rssSourceBody(body) as never)
      .then((r) => ok(c, r))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss source create failed");
      });
  }

  rssSourceUpdate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body || typeof body.sourceId !== "string" || body.sourceId === "") {
      fail(c, 400, "sourceId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    // 更新需要完整源 DTO（daemon 侧整对象替换语义）：以现值打底，覆盖白名单字段
    this.engine
      .rssListSources()
      .then((sources) => {
        const cur = sources.find((s) => s.sourceId === body.sourceId);
        if (!cur) {
          fail(c, 404, "rss source not found");
          return;
        }
        const merged = {
          ...cur,
          ...this.rssSourceBody(body),
          sourceId: cur.sourceId,
        } as import("../core/fluxdown.ts").FdRssSource;
        return this.engine!.rssUpdateSource(merged).then((okRes) =>
          ok(c, { updated: okRes?.ok === true }),
        );
      })
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss source update failed");
      });
  }

  rssSourceDelete(c: Ctx): void {
    const sourceId = c.params.sourceId ?? "";
    if (sourceId === "") {
      fail(c, 400, "sourceId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssDeleteSource(sourceId)
      .then((r) => ok(c, { deleted: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss source delete failed");
      });
  }

  rssSourceRefresh(c: Ctx): void {
    const sourceId = c.params.sourceId ?? "";
    if (sourceId === "") {
      fail(c, 400, "sourceId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssRefreshSource(sourceId)
      .then((r) => ok(c, { refreshed: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss source refresh failed");
      });
  }

  rssSourceItems(c: Ctx): void {
    const sourceId = c.params.sourceId ?? "";
    if (sourceId === "") {
      fail(c, 400, "sourceId is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssGetItems(sourceId)
      .then((items) => ok(c, items))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss items query failed");
      });
  }

  rssItemAction(c: Ctx): void {
    const sourceId = c.params.sourceId ?? "";
    const body = asObject(c.body) ?? {};
    const guid = typeof body.guid === "string" ? body.guid : "";
    const action =
      body.action === "download" || body.action === "ignore" || body.action === "readAll"
        ? body.action
        : "";
    if (sourceId === "" || action === "" || (action !== "readAll" && guid === "")) {
      fail(c, 400, "sourceId/guid/action required (guid ignored only for readAll)");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssItemAction(sourceId, guid, action)
      .then((r) => ok(c, { done: r.ok === true }))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss item action failed");
      });
  }

  /** feed 校验（添加订阅前的只读探测：标题 + 条目预览） */
  rssValidate(c: Ctx): void {
    const body = asObject(c.body);
    if (!body || typeof body.url !== "string" || body.url === "") {
      fail(c, 400, "url is required");
      return;
    }
    if (!this.engine) {
      fail(c, 500, "download engine not configured");
      return;
    }
    this.engine
      .rssValidate({
        url: body.url as string,
        cookies: typeof body.cookies === "string" ? body.cookies : undefined,
        userAgent: typeof body.userAgent === "string" ? body.userAgent : undefined,
        proxyUrl: typeof body.proxyUrl === "string" ? body.proxyUrl : undefined,
      })
      .then((r) => ok(c, r))
      .catch((err: any) => {
        if (err instanceof FluxDownUnavailableError) {
          fail(c, 503, err.message);
          return;
        }
        fail(c, 400, err?.message ?? "rss validate failed");
      });
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
      segments: number | null;
      queueId: string | null;
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
          // 直链分段数（FluxDown 动态分段；0/null = 引擎自动推荐）
          segments:
            typeof o.segments === "number" &&
            Number.isFinite(o.segments) &&
            o.segments >= 0 &&
            o.segments <= 64
              ? Math.round(o.segments)
              : null,
          // 归属命名队列（FluxDown daemon.queue；空 = 引擎默认 main）
          queueId:
            typeof o.queueId === "string" && o.queueId.trim() !== ""
              ? o.queueId.trim()
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
        const startErrors: Array<{ id: number; message: string }> = [];
        if (startDownload) {
          const localPath = (this.conf.get("local") ?? "") as string;
          for (const v of videos) {
            try {
              await this.downloadSvc!.startDownload(v.id, localPath, false);
            } catch (err: any) {
              const message = err?.message ?? String(err);
              logger.warn(`auto-start download failed id=${v.id}: ${message}`);
              // 未启动过的死行回滚删除（无引擎关联/无产物，保留只会是
              // 一条「失败」噪音）；提交失败应把原因带回给表单
              this.downloadSvc!.deleteUnstartedRow(v.id);
              startErrors.push({ id: v.id, message });
            }
          }
        }
        if (startErrors.length > 0 && startErrors.length === videos.length) {
          // 全部启动失败：整单拒绝（表单留在原地展示错误）
          fail(c, 400, startErrors[0]!.message);
          return;
        }
        const started = videos.filter(
          (v) => !startErrors.some((e) => e.id === v.id),
        );
        const ids = started.map((v) => v.id);
        this.hub.broadcast("download-create", { ids, count: ids.length });
        ok(c, started);
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
    // 归属队列（引擎任务；下次启动/重提生效——在途任务请用详情抽屉换队列）
    if ("queueId" in body) {
      data.queueId =
        typeof body.queueId === "string" && body.queueId.trim() !== ""
          ? body.queueId.trim()
          : null;
    }
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
