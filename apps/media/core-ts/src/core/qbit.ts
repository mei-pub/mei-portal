// core/qbit —— qBittorrent Web API v2 客户端（BT/磁力主引擎）
//
// BT 链路全面切到 qBittorrent（专门开源 BT 实现）：磁力秒级解析（libtorrent
// 常驻温热 DHT + 内置 trackers）、选文件（filePrio）、改名、未完成 .!qB
// 后缀保护、完成后停种 —— 迅雷式体验由专业 BT 栈承担，aria2 只保留普通
// 文件下载 + 对外 RPC 通用引擎。
//
// core 与 qB 同容器（supervisord program），走 127.0.0.1:8080；凭据由
// entrypoint 生成（/data/media/qbit-credentials.json），设置页可查看。

import fs from "node:fs";
import crypto from "node:crypto";
import { logger } from "../logger.ts";

/** qB 单种子状态（torrents/info 条目子集，只取本链路消费的字段） */
export interface QBitTorrentInfo {
  hash: string;
  name: string;
  /** metaDL/downloading/stalledDL/pausedDL/uploading/pausedUP/error/missingFiles… */
  state: string;
  /** 0-1 */
  progress: number;
  /** bytes/s */
  dlspeed: number;
  /** 总字节 */
  size: number;
  /** 已完成字节 */
  completed: number;
  /** 完成时间戳（-1 = 从未完成） */
  completion_on: number;
  save_path: string;
}

/** qB 种子文件条目（index 0-based） */
export interface QBitFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
}

/** qB 不可用（未安装/未启动/凭据失效）—— 调用方转用户可读错误 */
export class QBitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QBitUnavailableError";
  }
}

export interface QBitConfig {
  baseUrl: string;
  username: string;
  password: string;
}

/** qB 凭据文件路径（core 接管生成，entrypoint 只写非凭据 conf） */
export function qbitCredentialsFile(): string {
  return process.env.MEI_QBIT_CREDENTIALS ?? "/data/media/qbit-credentials.json";
}

/** 读已生成的 qB 凭据文件；缺失时给 qB 出厂凭据（首启接管用） */
export function loadQBitConfig(baseUrl: string): QBitConfig {
  try {
    const raw = JSON.parse(
      fs.readFileSync(qbitCredentialsFile(), "utf8"),
    ) as { username?: string; password?: string };
    if (raw.username && raw.password) {
      return { baseUrl, username: raw.username, password: raw.password };
    }
  } catch {
    // 凭据文件不存在（首启）：出厂凭据
  }
  return { baseUrl, username: "admin", password: "adminadmin" };
}

/**
 * BT 引擎凭据初始化（幂等，core 启动时调用一次）：
 * - 凭据文件已存在 → 直接用（我们经 API 设置过的密码必然有效）
 * - 不存在（qB 全新首启）→ 出厂凭据（admin/adminadmin）登录 → 生成随机强
 *   密码 → 经 API 改密（qB 自己序列化格式，杜绝手写 conf PBKDF2 的坑，
 *   实测 qB 4.5.2 会把 @ByteArray 字面值当纯字符串忽略）→ 写凭据文件
 * - 出厂凭据也登录失败（qB 密码被外部修改过）→ 抛错（设置页显示引擎异常，
 *   尊重用户自己的 qB 管理；conf 已放宽 ban 阈值防重试自禁）
 */
export async function ensureQbitClient(baseUrl: string): Promise<QBitClient> {
  if (fs.existsSync(qbitCredentialsFile())) {
    return new QBitClient(loadQBitConfig(baseUrl));
  }
  const factory = new QBitClient({
    baseUrl,
    username: "admin",
    password: "adminadmin",
  });
  await factory.login(); // 出厂凭据（失败 = qB 已被外部接管，上抛）
  const password = crypto.randomBytes(24).toString("base64url").slice(0, 20);
  await factory.setPreferences({ web_ui_password: password });
  fs.writeFileSync(
    qbitCredentialsFile(),
    JSON.stringify({ username: "admin", password }),
    { mode: 0o600 },
  );
  logger.info("qbittorrent credentials initialized (random password generated)");
  return new QBitClient({ baseUrl, username: "admin", password });
}

export class QBitClient {
  // 注意：--experimental-strip-types 不支持 TS 参数属性，字段须显式赋值
  private readonly cfg: QBitConfig;
  private sid = "";
  private loggingIn: Promise<void> | null = null;

  constructor(cfg: QBitConfig) {
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, "") };
  }

  private async login(): Promise<void> {
    this.loggingIn ??= (async () => {
      const body = new URLSearchParams({
        username: this.cfg.username,
        password: this.cfg.password,
      });
      const res = await fetch(`${this.cfg.baseUrl}/api/v2/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: `${this.cfg.baseUrl}/`,
        },
        body,
        signal: AbortSignal.timeout(8000),
      }).catch(() => {
        throw new QBitUnavailableError(
          "BT 引擎不可达（qbittorrent 未启动？）",
        );
      });
      if (!res.ok) {
        throw new QBitUnavailableError(`BT 引擎登录失败：HTTP ${res.status}`);
      }
      const text = (await res.text().catch(() => "")).trim();
      if (text !== "Ok.") {
        throw new QBitUnavailableError(
          "BT 引擎凭据不匹配（qB 密码可能已被修改）",
        );
      }
      const cookie = res.headers.get("set-cookie") ?? "";
      const m = /SID=([^;]+)/.exec(cookie);
      if (!m) throw new QBitUnavailableError("BT 引擎登录失败：无 SID");
      this.sid = m[1]!;
    })().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  /** API 请求：SID 过期自动重登录一次；Referer 必带（qB CSRF 防护：
   *  非 GET 请求的 Origin/Referer 必须匹配 WebUI 地址） */
  private async request(
    apiPath: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    const res = await fetch(`${this.cfg.baseUrl}${apiPath}`, {
      ...init,
      headers: {
        // qB CSRF 校验 Referer 必须与 WebUI 地址匹配，缺省/不匹配 → 403
        Referer: `${this.cfg.baseUrl}/`,
        ...(init.headers as Record<string, string> | undefined),
        ...(this.sid !== "" ? { Cookie: `SID=${this.sid}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    }).catch(() => {
      throw new QBitUnavailableError("BT 引擎不可达（qbittorrent 未启动？）");
    });
    if (res.status === 401 && retry) {
      await this.login();
      return this.request(apiPath, init, false);
    }
    return res;
  }

  private async ensureOk(
    res: Response,
    what: string,
  ): Promise<void> {
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 120);
      throw new QBitUnavailableError(`BT 引擎 ${what} 失败：HTTP ${res.status} ${text}`);
    }
  }

  /** 健康检查（登录 + 版本） */
  async version(): Promise<string> {
    await this.login();
    const res = await this.request("/api/v2/app/version");
    await this.ensureOk(res, "健康检查");
    return res.text();
  }

  /** 查询种子状态（hash 省略 = 全部） */
  async getInfo(hash?: string): Promise<QBitTorrentInfo[]> {
    const q = hash ? `?hashes=${hash}` : "";
    const res = await this.request(`/api/v2/torrents/info${q}`);
    await this.ensureOk(res, "状态查询");
    return (await res.json()) as QBitTorrentInfo[];
  }

  /** 种子属性（真名/总大小） */
  async getProperties(
    hash: string,
  ): Promise<{ name: string; total_size: number; save_path: string }> {
    const res = await this.request(
      `/api/v2/torrents/properties?hash=${hash}`,
    );
    await this.ensureOk(res, "属性查询");
    return (await res.json()) as {
      name: string;
      total_size: number;
      save_path: string;
    };
  }

  /** 文件清单（index 0-based；metadata 未到时为空/占位） */
  async getFiles(hash: string): Promise<QBitFile[]> {
    const res = await this.request(`/api/v2/torrents/files?hash=${hash}`);
    await this.ensureOk(res, "文件清单查询");
    return (await res.json()) as QBitFile[];
  }

  /**
   * 添加磁力（返回 false = 已存在同 hash 种子，qB 拒绝重复添加）。
   * paused 必须为 false：qB 的 paused 会同时停住 metadata 抓取。
   */
  async addMagnet(
    magnet: string,
    opts: { savepath: string },
  ): Promise<boolean> {
    const body = new URLSearchParams({ urls: magnet, savepath: opts.savepath });
    const res = await this.request("/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    await this.ensureOk(res, "磁力添加");
    return (await res.text()).trim() !== "Fails.";
  }

  /** 添加本地 .torrent 文件（filedata，返回 false = 已存在） */
  async addTorrentFile(
    buf: Buffer,
    opts: { savepath: string; name?: string },
  ): Promise<boolean> {
    const form = new FormData();
    form.append(
      "torrents",
      new Blob([new Uint8Array(buf)]),
      opts.name ?? "seed.torrent",
    );
    form.append("savepath", opts.savepath);
    const res = await this.request("/api/v2/torrents/add", {
      method: "POST",
      body: form,
    });
    await this.ensureOk(res, "种子添加");
    return (await res.text()).trim() !== "Fails.";
  }

  /** 文件优先级：ids 是 0-based 文件索引；priority 0 = 不下载 / 1 = 普通 */
  async setFilePriority(
    hash: string,
    ids: number[],
    priority: 0 | 1,
  ): Promise<void> {
    if (ids.length === 0) return;
    const body = new URLSearchParams();
    for (const id of ids) body.append("id", String(id));
    const res = await this.request(
      `/api/v2/torrents/filePrio?hash=${hash}&priority=${priority}`,
      { method: "POST", body },
    );
    await this.ensureOk(res, "文件优先级设置");
  }

  /** 改种子名（下载中心任务名 → qB 种子名/落盘名） */
  async renameTorrent(hash: string, name: string): Promise<void> {
    const body = new URLSearchParams({ hash, name });
    const res = await this.request("/api/v2/torrents/rename", {
      method: "POST",
      body,
    });
    await this.ensureOk(res, "种子改名");
  }

  /**
   * 导出种子 .torrent 文件（元数据缓存：提交任务时直接喂给引擎免重抓）。
   * 4.5.2 无 setSavePath（保存目录迁移是 5.0 API）——「解析暂存 → 任务目录」
   * 的迁移改为：delete 暂存 + 用导出的 .torrent 重新 add 到正式目录。
   */
  async exportTorrent(hash: string): Promise<Buffer> {
    const res = await this.request(
      `/api/v2/torrents/export?hash=${hash}`,
    );
    await this.ensureOk(res, "种子导出");
    return Buffer.from(await res.arrayBuffer());
  }

  /** 兼容启动：qB 5.0+ torrents/start，旧版（4.x）回退 torrents/resume。
   *  参数经 form body（qB 4.5.2 的 POST 参数解析在 body，query 传参 400） */
  async startTorrent(hash: string): Promise<void> {
    let res = await this.request("/api/v2/torrents/start", {
      method: "POST",
      body: new URLSearchParams({ hashes: hash }),
    });
    if (res.status === 404) {
      res = await this.request("/api/v2/torrents/resume", {
        method: "POST",
        body: new URLSearchParams({ hashes: hash }),
      });
    }
    await this.ensureOk(res, "启动");
  }

  /** 停止（下载中心不做种：完成后停）：qB 5.0+ stop，旧版回退 pause */
  async stopTorrent(hash: string): Promise<void> {
    let res = await this.request("/api/v2/torrents/stop", {
      method: "POST",
      body: new URLSearchParams({ hashes: hash }),
    });
    if (res.status === 404) {
      res = await this.request("/api/v2/torrents/pause", {
        method: "POST",
        body: new URLSearchParams({ hashes: hash }),
      });
    }
    await this.ensureOk(res, "停止");
  }

  /** 删除种子（deleteFiles = 同时删落盘文件）。参数经 form body（同上） */
  async deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
    const res = await this.request("/api/v2/torrents/delete", {
      method: "POST",
      body: new URLSearchParams({
        hashes: hash,
        deleteFiles: String(deleteFiles),
      }),
    });
    await this.ensureOk(res, "删除");
  }

  /** 应用级偏好（启动 ensure：.!qB 未完成后缀等） */
  async setPreferences(json: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(json);
    const res = await this.request("/api/v2/app/setPreferences", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ json: body }),
    });
    await this.ensureOk(res, "偏好设置");
  }

  /**
   * core 启动时的 BT 引擎初始化（幂等）：
   * - 未完成后缀 .!qB（下载中文件不占用最终名 —— 对齐迅雷临时后缀保护）
   * - 队列排队上限放开（下载中心自己做并发管理，qB 只做执行器）
   */
  async ensureBtPreferences(): Promise<void> {
    await this.login();
    await this.setPreferences({
      incomplete_files_ext: true,
      max_active_downloads: 32,
      max_active_torrents: 64,
    });
    logger.info("qbittorrent BT engine preferences ensured (.!qB suffix)");
  }
}
