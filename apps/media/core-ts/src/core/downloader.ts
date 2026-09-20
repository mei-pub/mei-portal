// core/downloader —— Go internal/core/downloader.go 的复刻：外部二进制执行下载，不重写下载算法

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../logger.ts";
import { execRun, CanceledError } from "./runner.ts";
import { torrentInfoHash, type TorrentFileEntry } from "./bencode.ts";
import {
  QBitClient,
  QBitUnavailableError,
  loadQBitConfig,
  type QBitFile,
} from "./qbit.ts";
import { LineParser, ProgressTracker, type ParseState } from "./parser.ts";
import { getByType, type Schema, type SchemaList } from "./schema.ts";
import type {
  Aria2Options,
  Aria2RpcOptions,
  Callbacks,
  DownloadParams,
  DownloaderConfig,
  ProgressEvent,
} from "./types.ts";

// ---- 内置下载目录（下载中心三类任务各自的落盘目录）----
// 下载总根 = localDir 的父目录（部署 localDir=/downloads/movie，影视应用对接
// 专用；媒体自身任务的目录独立在 movie/music 之外）。folder 值精确等于内置
// key（bt/files/video）→ 落 <下载根>/<key>；其余 folder（影视分类/剧名等既有
// 数据与跨应用契约）沿用 localDir+folder 老规则。

export const BUILTIN_DIR_KEYS = ["bt", "files", "video"] as const;
export type BuiltinDirKey = (typeof BUILTIN_DIR_KEYS)[number];

export const BUILTIN_DIR_LABELS: Record<BuiltinDirKey, string> = {
  bt: "磁力下载",
  files: "普通文件",
  video: "视频下载",
};

/** folder 是否内置目录 key（精确匹配，sanitize 后比较） */
export function isBuiltinDirKey(
  folder: string | null | undefined,
): folder is BuiltinDirKey {
  return (
    folder !== null &&
    folder !== undefined &&
    (BUILTIN_DIR_KEYS as readonly string[]).includes(folder)
  );
}

/** 下载总根：localDir 的父目录（localDir 形如 /downloads/movie → /downloads） */
export function downloadRoot(localDir: string): string {
  return path.dirname(localDir);
}

/**
 * 任务落盘目录解析（buildArgs localDir / downloadList exists 检查 / 删除清理
 * 三处共用的唯一规则）：
 * - 内置 key（bt/files/video）→ <下载根>/<key>（独立于 movie/music 对接目录）
 * - 其它非空 folder → localDir/<folder>（影视 分类/剧名、旧数据）
 * - 空 → localDir
 */
export function resolveTaskDir(
  folder: string | null | undefined,
  localDir: string,
): string {
  const f = sanitizeFolder(folder ?? "");
  if (isBuiltinDirKey(f)) {
    return path.join(downloadRoot(localDir), f);
  }
  return f !== "" ? path.join(localDir, f) : localDir;
}

// ---- 下载中临时目录（保护已存在文件不被半成品污染，对齐迅雷 .td 思路）----
// 下载器统一写入 <任务目录>/.meipart-<任务id>/，任务成功后由 service 层把产物
// rename 到 <任务目录>/<最终名>（fs.rename 同分区原子）；失败/停止保留临时目录
// （aria2 的 .aria2 控制文件可续传），删除任务时级联清理。已存在文件在整个
// 下载过程中不被写打开，「重新下载」也不会先把旧文件截断。

/** 任务专属临时目录名（buildArgs 与 finalize/清理/进度回写四处共用） */
export const TMP_DIR_PREFIX = ".meipart-";

export function taskTmpDir(
  id: string,
  folder: string | null | undefined,
  localDir: string,
): string {
  return path.join(resolveTaskDir(folder, localDir), TMP_DIR_PREFIX + id);
}

export class UnsupportedTypeError extends Error {
  readonly taskType: string;
  constructor(taskType: string) {
    super(`unsupported download type: "${taskType}"`);
    this.name = "UnsupportedTypeError";
    this.taskType = taskType;
  }
}

/**
 * SanitizeFilename —— 与 Go 完全一致（文件名在 下载器/DB/文件检查三处一致是隐性契约）：
 * - 控制字符（<0x20）丢弃
 * - \ / : * ? " < > | → 下划线
 * - 去掉结尾的 . 和空格；全非法时回退 "download"
 */
export function sanitizeFilename(name: string): string {
  if (name === "") return "download";
  const out: string[] = [];
  for (const r of name) {
    const code = r.codePointAt(0)!;
    if (code < 0x20) continue; // 控制字符 → 丢弃
    if ('\\/:*?"<>|'.includes(r)) out.push("_");
    else out.push(r);
  }
  const cleaned = out.join("").replace(/[. ]+$/, "");
  if (cleaned === "") return "download";
  return cleaned;
}

/**
 * 清洗任务子目录（folder）：DB 记录的 folder 是用户可控输入，而它会被拼进
 * 下载目录（localDir/folder）与视频文件解析路径。这里按路径段过滤，剔除
 * 空段 / '.' / '..'，并统一使用平台分隔符，杜绝 `../` 逃出 localDir。
 * 正常的多级目录（如 "番剧/第一季"）不受影响。
 */
export function sanitizeFolder(folder: string): string {
  const parts = folder
    .split(/[\\/]+/)
    .filter((p) => p !== "" && p !== "." && p !== "..");
  return parts.join("/");
}

// ---- qBittorrent 链路辅助 ----

/** 磁力解析结果（任务创建前强制内容识别；existed/completed 驱动 UI 提示） */
export interface BtResolveResult {
  hash: string;
  name: string;
  size: number;
  /** 1-based 文件索引（与 UI 勾选/aria2 --select-file 语义一致） */
  files: TorrentFileEntry[] | null;
  /** 已在 BT 引擎中存在（解析暂存续用 / 历史任务 / WebUI 手加） */
  existed: boolean;
  /** 已存在且下载完成（UI 提示取消 / 重新下载） */
  completed: boolean;
}

/** BT 任务 hash 推导：磁力 btih / 本地种子文件 infohash（不信客户端传值） */
export function btHashFor(url: string): string {
  const m = /urn:btih:([0-9a-fA-F]{40})/i.exec(url);
  if (m) return m[1]!.toLowerCase();
  if (/\.torrent$/i.test(url)) {
    const h = torrentInfoHash(fs.readFileSync(url));
    if (!h) throw new Error("种子文件解析失败（infohash 计算）");
    return h;
  }
  throw new Error(`unsupported bt url: ${url.slice(0, 60)}`);
}

/** "1,3-5" → Set{1,3,4,5}（1-based 文件索引） */
function parseSelectFile(sel: string): Set<number> {
  const out = new Set<number>();
  for (const part of sel.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    for (let i = lo; i <= hi && i - lo < 1000; i++) out.add(i);
  }
  return out;
}

/** qB 文件清单（0-based）→ UI 文件清单（1-based，含相对路径） */
function qbitFilesToMeta(files: QBitFile[]): TorrentFileEntry[] | null {
  if (files.length === 0) return null;
  return files.map((f, i) => ({
    index: i + 1,
    path: f.name,
    size: f.size,
  }));
}

/** 磁力解析暂存根目录（configDir/torrents/staging；每 hash 一个子目录） */
export function btStagingRoot(configDir: string): string {
  return path.join(configDir, "torrents", "staging");
}

/**
 * 磁力链接只带 btih 不带 webseed/tracker，peer 发现全压 DHT 单通道——
 * 网盘搜索来源的磁力多为 webseed 为主或半冷资源（如发行版 ISO），
 * DHT 上 peer 稀少，等不到 metadata 就超时。add 前追加 tr= 参数让
 * qB 走 DHT + tracker 双通道找 peer，冷种解析率大幅提升。
 */
/** 磁力不含 tracker 时追加公共 tracker（自带 tr= 的原样保留，尊重发布者） */
export function withBtTrackers(magnet: string): string {
  if (!/^magnet:/i.test(magnet) || /(^|[&?])tr=/.test(magnet)) return magnet;
  const sep = magnet.includes("?") ? "&" : "?";
  return (
    magnet +
    sep +
    PUBLIC_BT_TRACKERS.map((t) => `tr=${encodeURIComponent(t)}`).join("&")
  );
}

/**
 * aria2 RPC 对外引擎配置收敛（conf 值不可信）：enabled 默认开、端口夹在
 * [1024, 65535]（默认 6800）、secret 非空（空 = 服务端首启生成）。
 */
export function normalizeAria2Rpc(v: unknown): Aria2RpcOptions {
  const o = (typeof v === "object" && v !== null ? v : {}) as {
    enabled?: unknown;
    port?: unknown;
    secret?: unknown;
  };
  const portNum = Number(o.port);
  return {
    enabled: o.enabled !== false,
    port:
      Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535
        ? portNum
        : 6800,
    secret: typeof o.secret === "string" && o.secret !== "" ? o.secret : "",
  };
}

/** bytes/s → "2.5MiB/s"（对齐 aria2 DL: 输出格式，UI 原样展示） */
function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0B/s";
  const units = ["B", "KiB", "MiB", "GiB"];
  let v = bytesPerSec;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${units[u]}/s`;
}

// ---- aria2 动态参数的防御工具（conf 值来自用户 JSON，不可信）----

/** 数字收敛：非有限数/越界回退默认，夹进 [min, max] */
function clampNum(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 速度/大小值清洗：`\d+([KM]i?B?)?`（1M / 512K / 2M）。
 * - minBytes：字节下限（aria2 --min-split-size 合法区间 [1M, 1G]，低于 1M 回退默认，
 *   否则 aria2c 启动即 exit 28）
 * - 非法 → fallback（空串=由调用方跳过该参数）
 */
function sanitizeSpeedSize(v: unknown, fallback: string, minBytes = 0): string {
  if (typeof v !== "string" || v === "") return fallback;
  const m = /^(\d+)([KM]i?B?)?$/i.exec(v.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toUpperCase();
  const bytes = unit.startsWith("M")
    ? n * 1048576
    : unit.startsWith("K")
      ? n * 1024
      : n;
  if (bytes < minBytes) return fallback;
  return `${m[1]}${unit}`;
}

/** 端口/端口段清洗：`6881` 或 `6881-6999`（段长 ≤ 200）；非法 → 空（不注入，用 aria2 默认） */
function sanitizePortRange(v: unknown): string {
  if (typeof v !== "string" || v === "") return "";
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(v.trim());
  if (!m) return "";
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  if (lo < 1 || lo > 65535 || hi < lo || hi > 65535 || hi - lo > 200) return "";
  return m[2] !== undefined ? `${lo}-${hi}` : `${lo}`;
}

/** 逗号/换行分隔列表 → 去空去重的数组（tracker 列表用） */
function splitList(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return Array.from(
    new Set(
      v
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    ),
  );
}

/**
 * 收敛任意 conf 值为合法 Aria2Options（启动读取与热更新共用）：
 * 缺字段补默认、类型错回退、布尔仅显式 false 才关（历史 config.json 无 aria2 段时全默认）。
 */
export function normalizeAria2Options(v: unknown): Aria2Options {
  const o =
    v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const bt =
    o.bt !== null && typeof o.bt === "object"
      ? (o.bt as Record<string, unknown>)
      : {};
  return {
    connections: clampNum(o.connections, 16, 1, 16),
    splits: clampNum(o.splits, 16, 1, 128),
    // aria2 --min-split-size 合法区间 [1M, 1G]：低于 1M 回退 1M
    minSplitSize: sanitizeSpeedSize(o.minSplitSize, "1M", 1048576),
    speedLimit: sanitizeSpeedSize(o.speedLimit, ""),
    maxTries: clampNum(o.maxTries, 5, 0, 99),
    retryWait: clampNum(o.retryWait, 0, 0, 60),
    bt: {
      enableDht: bt.enableDht !== false,
      enableLpd: bt.enableLpd !== false,
      enablePex: bt.enablePex !== false,
      listenPort: sanitizePortRange(bt.listenPort),
      uploadLimit: sanitizeSpeedSize(bt.uploadLimit, ""),
      maxPeers: clampNum(bt.maxPeers, 55, 1, 999),
      trackers: typeof bt.trackers === "string" ? bt.trackers : "",
    },
  };
}

/**
 * 从 URL 推断扩展名（direct 保存文件名用）。
 * 普通下载不再限定死视频：优先提取路径最后一段的真实扩展（1-5 位字母数字，
 * 如 .zip/.iso/.epub 原样保留）；URL 无法解析出扩展时按流媒体常见后缀兜底、
 * 最终回退 mp4（与旧 Go guessExtFromURL 的回退语义一致）。
 */
export function guessExtFromURL(u: string): string {
  try {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(new URL(u).pathname);
    if (m) return m[1]!.toLowerCase();
  } catch {
    // 非法 URL → 走下方兜底
  }
  const l = u.toLowerCase();
  if (l.includes(".m3u8")) return "m3u8";
  if (l.includes(".mp4")) return "mp4";
  if (l.includes(".flv")) return "flv";
  if (l.includes(".mkv")) return "mkv";
  return "mp4";
}

// ---- BT 网络加速参数 ----
// 公共 tracker + DHT 路由表持久化 + 显式引导节点：aria2 守护的 BT 下载
// （第三方客户端经 RPC 提交的磁力任务）与 qB 链路的磁力解析/任务 add
// （withBtTrackers）共用这份公共 tracker 清单，开箱即用不依赖冷启动 bootstrap。
// 注：下载中心自身的 BT/磁力链路走 qBittorrent（专门 BT 栈，libtorrent
// 常驻温热 DHT）；aria2 只承担普通文件下载 + 对外 RPC 引擎。

const PUBLIC_BT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.tamersunion.org:443/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.io:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.auctor.tv:6969/announce",
  "udp://bt1.archive.org:6969/announce",
  "udp://bt2.archive.org:6969/announce",
];

/** DHT 引导节点（冷启动显式 ping，快于默认配置的被动发现） */
const DHT_ENTRY_POINT = "router.bittorrent.com:6881";

/** 用户 trackers（conf）∪ 公共 tracker —— aria2 守护 BT 能力兜底 */
function mergedTrackers(userTrackers: string): string {
  const set = new Set<string>([
    ...splitList(userTrackers),
    ...PUBLIC_BT_TRACKERS,
  ]);
  return [...set].join(",");
}

/** DHT 持久化参数（dhtFile 为空返回空数组；IPv4/IPv6 双表） */
function dhtArgs(dhtFile: string): string[] {
  if (!dhtFile) return [];
  return [
    "--dht-file-path",
    dhtFile,
    "--dht-file-path6",
    `${dhtFile}.v6`,
    "--dht-entry-point",
    DHT_ENTRY_POINT,
    "--dht-entry-point6",
    DHT_ENTRY_POINT,
  ];
}

/**
 * aria2 RPC 对外引擎守护（完整 aria2 能力 + 第三方客户端接入控制）。
 *
 * core 启动即拉起常驻 aria2c（supervisord 拉起 core，core 拉起守护）：
 * - 固定端口 / 固定 secret（conf.aria2Rpc 驱动，设置页可查看 / 重置），
 *   监听 0.0.0.0 —— 经 compose 端口映射供宿主 / 局域网的第三方客户端
 *   （AriaNg、手机 App、浏览器扩展）接入控制
 * - 下载中心普通文件下载（direct）仍走独立短进程（stdout 进度解析闭环成熟），
 *   本守护专职对外服务：第三方 addUri 的任务落下载根（/downloads），
 *   文件落在下载中心目录树下统一管理
 * - BT 全能力保留：公共 tracker 注入 + DHT 路由表持久化 + bt-save-metadata，
 *   第三方经 RPC 提交的磁力任务同样秒级出元数据
 * - 崩溃自愈：ensure() 探活失败自动重启；pid 存根跨代清理孤儿
 */
class Aria2RpcDaemon {
  private child: ChildProcess | null = null;
  private starting: Promise<boolean> | null = null;
  private exited = false;
  // 注意：--experimental-strip-types 不支持 TS 参数属性，字段须显式赋值
  private readonly opts: {
    bin: string;
    port: number;
    secret: string;
    /** 第三方任务的默认落盘目录（下载根） */
    dir: string;
    dhtFile: string;
    trackers: string;
  };

  constructor(
    opts: {
      bin: string;
      port: number;
      secret: string;
      dir: string;
      dhtFile: string;
      trackers: string;
    },
  ) {
    this.opts = opts;
    // core 退出时收守护（SIGTERM 触发 aria2 保存 DHT 表再退出）
    const kill = () => this.stop();
    process.once("exit", kill);
    process.once("SIGTERM", () => {
      kill();
      process.exit(0);
    });
  }

  get listenPort(): number {
    return this.opts.port;
  }

  stop(): void {
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // 已退出
      }
      this.child = null;
    }
  }

  private rpcUrl(): string {
    return `http://127.0.0.1:${this.opts.port}/jsonrpc`;
  }

  /** JSON-RPC 调用；网络失败返回 null（由自愈逻辑重启） */
  private async rpc<T>(
    method: string,
    ...params: unknown[]
  ): Promise<T | null> {
    try {
      const res = await fetch(this.rpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method,
          params: [`token:${this.opts.secret}`, ...params],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as {
        result?: T;
        error?: { message?: string };
      };
      if (payload.error) return null;
      return payload.result ?? null;
    } catch {
      return null;
    }
  }

  private async ping(): Promise<boolean> {
    return (await this.rpc<string>("aria2.getVersion")) !== null;
  }

  /** 拉起/探活守护（单飞）；返回是否可用 */
  ensure(): Promise<boolean> {
    if (this.exited) return Promise.resolve(false);
    if (this.child) {
      // 已有进程：探活，死了走自愈
      return this.ping().then((ok) => ok || this.restart());
    }
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private restart(): Promise<boolean> {
    this.stop();
    return this.spawn();
  }

  private async spawn(): Promise<boolean> {
    const args = [
      "--enable-rpc=true",
      `--rpc-listen-port=${this.opts.port}`,
      `--rpc-secret=${this.opts.secret}`,
      // 对外引擎：监听全部接口（宿主经 compose 端口映射接入）
      "--rpc-listen-all=true",
      `--dir=${this.opts.dir}`,
      // BT 全能力（第三方经 RPC 提交磁力任务）。BT/DHT 监听固定 6891
      //（缺省时 aria2 在 6881-6999 随机选，端口不可预知；镜像 EXPOSE 声明
      // 全部端口，与 qB 的 6881 错开）
      "--bt-save-metadata=true",
      "--listen-port=6891",
      "--dht-listen-port=6891",
      `--bt-tracker=${this.opts.trackers}`,
      `--dht-file-path=${this.opts.dhtFile}`,
      `--dht-file-path6=${this.opts.dhtFile}.v6`,
      "--dht-entry-point=router.bittorrent.com:6881",
      "--dht-entry-point6=router.bittorrent.com:6881",
      "--bt-tracker-timeout=5",
      "--bt-tracker-connect-timeout=5",
      "--connect-timeout=10",
      "--timeout=15",
      "--quiet",
      "--console-log-level=warn",
    ];
    try {
      fs.mkdirSync(this.opts.dir, { recursive: true });
      await this.killStaleDaemon(); // 含等待旧守护释放端口（异步 SIGTERM 退出）
      this.child = spawn(this.opts.bin, args, { stdio: "ignore" });
      this.child.unref();
      this.writePidFile();
      this.child.once("exit", (code) => {
        if (this.exited) return;
        logger.warn(`aria2 rpc daemon exited: code=${code}`);
        this.child = null;
        // 意外退出（如启动竞态 bind 失败 exit 1）：延迟自动重试一次，
        // 不依赖下一次 ensure（外部引擎要求常驻在线）
        setTimeout(() => void this.ensure(), 3000);
      });
    } catch (err: any) {
      logger.warn(
        `aria2 rpc daemon spawn failed: ${err?.message ?? err}`,
      );
      this.child = null;
      return false;
    }
    // 等 RPC 就绪（最多 5s）
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await this.ping()) {
        logger.info(
          `aria2 rpc daemon ready: port=${this.opts.port} (external engine for third-party clients)`,
        );
        return true;
      }
    }
    logger.warn("aria2 rpc daemon not ready in 5s");
    this.stop();
    return false;
  }

  /** 守护 pid 存根（跨代识别：core 异常退出（SIGKILL）时旧守护成孤儿，
   *  新一代守护启动时按此文件识别并清理，杜绝累积）。放 configDir
   *  （dhtFile 同目录），不污染对外可见的下载根 */
  private pidFile(): string {
    return path.join(path.dirname(this.opts.dhtFile), "aria2-rpc-daemon.pid");
  }

  private writePidFile(): void {
    try {
      if (this.child?.pid) {
        fs.writeFileSync(this.pidFile(), String(this.child.pid));
      }
    } catch {
      // pid 文件写失败不影响引擎
    }
  }

  /** 清理上一代孤儿守护（async）：SIGTERM 后等旧进程真正退出再放行 ——
   *  aria2 退出要异步保存 DHT/断连（秒级），不等就 spawn 新守护会 bind
   *  同端口失败（exit 1）。特征双校验防 pid 复用误杀 */
  private async killStaleDaemon(): Promise<void> {
    try {
      const raw = fs.readFileSync(this.pidFile(), "utf8").trim();
      const old = Number.parseInt(raw, 10);
      if (Number.isNaN(old) || old <= 0) return;
      const cmd = fs.readFileSync(`/proc/${old}/cmdline`, "utf8");
      if (cmd.includes("aria2c") && cmd.includes("--rpc-listen-port")) {
        process.kill(old, "SIGTERM");
        logger.info(`killed stale aria2 rpc daemon: pid=${old}`);
        // 等待旧守护释放 RPC 端口（最多 3s；ESRCH = 已退出）
        for (let i = 0; i < 30; i++) {
          try {
            process.kill(old, 0);
          } catch {
            return; // 已退出，端口已释放
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        logger.warn(`stale aria2 rpc daemon pid=${old} not exited in 3s`);
      }
    } catch {
      // 无 pid 文件 / 旧守护已退出（ESRCH）/ 非 Linux 无 /proc：无事
    }
  }
}

export class DownloaderSvc {
  private readonly binMap: { [t: string]: string };
  private readonly schemas: SchemaList;
  private readonly tracker = new ProgressTracker();
  private readonly cfg: DownloaderConfig;

  constructor(
    binMap: { [t: string]: string },
    schemas: SchemaList,
    cfg: DownloaderConfig,
  ) {
    this.binMap = binMap;
    this.schemas = schemas;
    this.cfg = cfg;
  }

  config(): DownloaderConfig {
    return this.cfg;
  }

  /**
   * BT 引擎（qBittorrent，同容器 supervisord 常驻）：
   * 磁力解析 / BT 下载执行 / 选文件 / 改名 / 停种全走 qB Web API。
   * libtorrent 常驻温热 DHT + 内置 trackers —— 磁力秒级出元数据。
   */
  private qbitClient: QBitClient | null = null;
  private aria2Rpc: Aria2RpcDaemon | null = null;

  /** qB 客户端：优先用初始化链注入的实例（凭据已验证可用），否则懒构造 */
  qbit(): QBitClient {
    this.qbitClient ??= new QBitClient(
      loadQBitConfig(process.env.MEI_QBIT_BASEURL ?? "http://127.0.0.1:8080"),
    );
    return this.qbitClient;
  }

  /** server 启动链注入（ensureQbitClient + ensureBtPreferences 之后的实例） */
  setQbitClient(client: QBitClient): void {
    this.qbitClient = client;
  }

  /**
   * 拉起 aria2 RPC 对外引擎（core 启动时调用；配置热更新后重启时也走这里）。
   * enabled=false 时确保已停。
   */
  async ensureAria2Rpc(): Promise<boolean> {
    const rpc = this.cfg.getAria2Rpc();
    const bin = this.binMap["direct"]; // aria2c 路径（direct/bt 同二进制）
    if (!rpc.enabled || !bin || !fs.existsSync(bin)) {
      this.aria2Rpc?.stop();
      this.aria2Rpc = null;
      if (rpc.enabled) logger.warn("aria2 rpc engine disabled: aria2c binary not found");
      return false;
    }
    const trackers = mergedTrackers(this.cfg.getAria2Options().bt.trackers);
    const dhtFile = this.cfg.getDhtFile?.() ?? "";
    this.aria2Rpc ??= new Aria2RpcDaemon({
      bin,
      port: rpc.port,
      secret: rpc.secret,
      dir: downloadRoot(this.cfg.getLocalDir()),
      dhtFile,
      trackers,
    });
    return this.aria2Rpc.ensure();
  }

  /** 配置变更（端口/开关/secret）后重建守护 */
  async restartAria2Rpc(): Promise<boolean> {
    this.aria2Rpc?.stop();
    this.aria2Rpc = null;
    return this.ensureAria2Rpc();
  }

  /** 对外引擎状态（设置页展示） */
  aria2RpcAlive(): boolean {
    return this.aria2Rpc !== null;
  }

  /**
   * 磁力链接内容解析（任务创建前的强制内容识别，对齐迅雷）：
   * qBittorrent 引擎 add 到解析暂存目录（running 状态抓 metadata ——
   * paused 会停住 metadata 抓取），元数据到手即 stop，返回种子真名/
   * 总大小/文件清单。已在引擎中的种子直接返回元数据（existed=true，
   * UI 按完成与否提示续传 / 重新下载）。
   */
  async resolveMagnetBt(
    magnet: string,
    stagingRoot: string,
    timeoutMs = 100000,
  ): Promise<BtResolveResult> {
    const qbit = this.qbit();
    const hashMatch = /urn:btih:([0-9a-fA-F]{40})/i.exec(magnet);
    if (!hashMatch) {
      throw new Error("invalid magnet link (missing 40-hex btih)");
    }
    const hash = hashMatch[1]!.toLowerCase();

    // 已在引擎中（含解析暂存续用 / qB WebUI 手加 / 历史任务）：直接给元数据
    const existing = (await qbit.getInfo(hash))[0];
    if (existing) {
      const files = await qbit.getFiles(hash);
      return {
        hash,
        name: existing.name,
        size: existing.size,
        files: qbitFilesToMeta(files),
        existed: true,
        completed: existing.progress >= 1,
      };
    }

    // add 到解析暂存目录（每 hash 独立子目录；running 抓 metadata）。
    // 追加公共 tracker：磁力不带 webseed，peer 发现不能只压 DHT 单通道
    const stagingDir = path.join(stagingRoot, hash);
    fs.mkdirSync(stagingDir, { recursive: true });
    const added = await qbit.addMagnet(withBtTrackers(magnet), {
      savepath: stagingDir,
    });
    if (added) {
      // 新任务首轮 tracker announce 有随机间隔（数十秒），立即强制通告，
      // 让 tracker 通道在解析窗口内尽早返回 peer
      await qbit
        .reannounceTorrent(hash)
        .catch((err) => logger.warn(`reannounce failed: ${err}`));
    }
    if (!added) {
      // 竞态（add 瞬间已存在）：按已存在语义返回
      const again = (await qbit.getInfo(hash))[0];
      if (!again) throw new Error("BT 引擎添加磁力失败");
      const files = await qbit.getFiles(hash);
      return {
        hash,
        name: again.name,
        size: again.size,
        files: qbitFilesToMeta(files),
        existed: true,
        completed: again.progress >= 1,
      };
    }

    // 轮询 metadata（qB 常驻 libtorrent DHT 温热，秒级）
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const files = await qbit.getFiles(hash);
      if (files.length > 0 && files.every((f) => f.size > 0)) {
        const props = await qbit.getProperties(hash);
        // 导出 .torrent 落 torrents 目录（提交任务时免重抓 metadata；
        // 4.5.2 无 setSavePath，暂存 → 正式目录的迁移靠它 re-add）
        try {
          const buf = await qbit.exportTorrent(hash);
          fs.writeFileSync(
            path.join(path.dirname(stagingRoot), `${hash}.torrent`),
            buf,
          );
        } catch (err) {
          logger.warn(
            `torrent export failed (submit will re-fetch metadata): ${err}`,
          );
        }
        // 停在暂存（不再抓数据）
        await qbit.stopTorrent(hash);
        logger.info(
          `magnet resolved via qbittorrent: ${hash} (${props.name})`,
        );
        return {
          hash,
          name: props.name,
          size: props.total_size,
          files: qbitFilesToMeta(files),
          existed: false,
          completed: false,
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    // 超时：清掉暂存种子，不留半成品
    await qbit
      .deleteTorrent(hash, true)
      .catch((err) => logger.warn(`staging cleanup failed: ${err}`));
    throw new Error(
      "磁力解析超时：DHT 与公共 tracker 均未发现做种节点，该资源可能已无人做种",
    );
  }

  /**
   * BT 任务执行（队列 bt 类型）：全走 qBittorrent。
   * - 磁力任务 url = 磁力原文；种子文件任务 url = torrents 目录内 .torrent
   *   （白名单已校验），hash 由 btih / 种子 infohash 推导（不信客户端）
   * - 已存在未完成 → 迁移到任务目录续传（含解析暂存续用）；
   *   已完成 → 删除重下（force 语义，resolve 阶段 UI 已确认）
   * - selectFile（"1,3-5"，1-based）→ qB filePrio 0/1
   * - 完成即 stop（下载中心不做种）；.!qB 未完成后缀由引擎偏好全局保护
   */
  private async downloadBtViaQbit(
    p: DownloadParams,
    cb: Callbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const qbit = this.qbit();
    const saveDir = resolveTaskDir(p.folder, this.cfg.getLocalDir());
    fs.mkdirSync(saveDir, { recursive: true });

    const hash = btHashFor(p.url);
    if (signal.aborted) throw new CanceledError();

    // 4.5.2 无 setSavePath（目录迁移是 5.0 API）：解析暂存 → 正式目录的
    // 迁移 = delete 暂存 + 用解析时导出的 .torrent 重新 add（metadata 免
    // 重抓，秒级起跑）。仅当种子已在任务目录（save_path 相同）才直接续传。
    const existing = (await qbit.getInfo(hash))[0];
    if (existing && existing.progress >= 1 && existing.save_path !== saveDir) {
      // 已完成但在别处（解析暂存/用户 qB 自加）→ 删了重下到任务目录
      await qbit.deleteTorrent(hash, true);
    } else if (existing && existing.save_path === saveDir) {
      // 已在任务目录：未完成续传 / 已完成幂等成功（重新下载语义在解析
      // 阶段已被用户确认，completed+saveDir 一致时无需再动）
      if (existing.progress >= 1) {
        logger.info(`bt task ${p.id}: torrent already completed in place`);
        return;
      }
      logger.info(`bt task ${p.id}: resume existing torrent in place`);
    } else if (existing) {
      // 在暂存/其它目录且未完成：清掉 re-add 到任务目录
      await qbit.deleteTorrent(hash, true);
    }
    if ((await qbit.getInfo(hash))[0] === undefined) {
      // 引擎中无该种子：添加（解析时导出的 .torrent 优先，免重抓 metadata；
      // 磁力原文兜底重新抓——qB 常驻温热，秒级）
      const configDir =
        this.cfg.getConfigDir?.() ?? path.dirname(this.cfg.getDhtFile?.() ?? "/data/media/dht.dat");
      const torrentCache = path.join(
        path.dirname(btStagingRoot(configDir)),
        `${hash}.torrent`,
      );
      let added = false;
      if (fs.existsSync(torrentCache)) {
        // 迁移 re-add 到全新任务目录：跳过校验，种子立即就绪（filePrio 可用）
        added = await qbit.addTorrentFile(fs.readFileSync(torrentCache), {
          savepath: saveDir,
          name: `${hash}.torrent`,
          skipChecking: true,
        });
      }
      if (!added && /^magnet:/i.test(p.url)) {
        added = await qbit.addMagnet(withBtTrackers(p.url), {
          savepath: saveDir,
        });
      } else if (!added && /\.torrent$/i.test(p.url)) {
        const buf = fs.readFileSync(p.url); // 白名单已校验（torrents 目录内）
        added = await qbit.addTorrentFile(buf, {
          savepath: saveDir,
          name: path.basename(p.url),
          skipChecking: true, // 新任务空目录，无需校验
        });
      }
      if (!added) throw new Error("BT 任务添加失败（种子已存在于引擎）");
    }

    // 先启动再选文件：qB 4.5.2 对 stopped / missingFiles 状态的种子拒绝
    // filePrio（HTTP 400）——任务重试续传、上轮失败残留等场景种子都处于
    // 非运行态，必须先 start（missingFiles 会触发重新检查文件）再设置优先级
    await qbit.startTorrent(hash);

    // 选文件（1-based 索引串 → qB 0-based 优先级；全选/空 = 全部，不调 prio）
    const sel = (p.selectFile ?? "").trim();
    if (sel !== "") {
      const selected = parseSelectFile(sel);
      const files = await qbit.getFiles(hash);
      if (selected.size > 0 && selected.size < files.length) {
        const keep: number[] = [];
        const skip: number[] = [];
        for (const f of files) {
          (selected.has(f.index + 1) ? keep : skip).push(f.index);
        }
        if (skip.length > 0) await qbit.setFilePriority(hash, skip, 0);
        if (keep.length > 0) await qbit.setFilePriority(hash, keep, 1);
        logger.info(
          `bt file selection id=${p.id} keep=${keep.length} skip=${skip.length}`,
        );
      }
    }

    // 改名（qB 种子名 = 落盘名；p.name 为空保持引擎种子真名）
    const name = sanitizeFilename(p.name ?? "");
    if (name !== "" && name !== "bt-download") {
      await qbit
        .renameTorrent(hash, name)
        .catch((err) => logger.warn(`bt rename failed: ${err}`));
    }

    // （startTorrent 已提前到选文件之前）轮询（1s；qB 短暂不可达容忍 60s，自愈恢复后续传）
    cb.onProgress?.({
      id: p.id,
      type: "ready",
      percent: 0,
      speed: "",
      isLive: false,
    } satisfies ProgressEvent);

    let unavailableStreak = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      if (signal.aborted) {
        await qbit.stopTorrent(hash).catch(() => {});
        throw new CanceledError();
      }
      let info;
      try {
        info = (await qbit.getInfo(hash))[0];
        unavailableStreak = 0;
      } catch (err) {
        if (err instanceof QBitUnavailableError) {
          if (++unavailableStreak > 60) throw err;
          continue; // qB 自愈重启中：等待恢复
        }
        throw err;
      }
      if (!info) {
        throw new Error("BT 任务在引擎中消失（可能被 qB WebUI 删除）");
      }
      if (info.progress >= 1) {
        // 完成即停种（下载中心不做种；已下文件保留做种也由用户在 qB 自行开）
        await qbit.stopTorrent(hash).catch(() => {});
        cb.onProgress?.({
          id: p.id,
          type: "progress",
          percent: 100,
          speed: "",
          isLive: false,
        } satisfies ProgressEvent);
        return;
      }
      if (info.state === "error" || info.state === "missingFiles") {
        throw new Error(`BT 下载出错（${info.state}）`);
      }
      cb.onProgress?.({
        id: p.id,
        type: "progress",
        percent: Math.round(info.progress * 100),
        speed: fmtSpeed(info.dlspeed),
        isLive: false,
      } satisfies ProgressEvent);
    }
  }

  /** 按 Schema 参数表构建命令行参数（与 Go buildArgs 逐条对齐） */
  buildArgs(p: DownloadParams, s: Schema): string[] {
    const out: string[] = [];
    const pushKV = (keys: string[], val: string) => {
      for (const k of keys) out.push(k, val);
    };

    for (const [key, spec] of Object.entries(s.args)) {
      switch (key) {
        case "url":
          if (spec.argsName.length > 0) out.push(...spec.argsName);
          out.push(p.url);
          break;
        case "localDir": {
          // 下载器统一写任务专属临时目录 .meipart-<id>（保护已存在文件）；
          // 成功后 service.finalizeTask rename 到任务目录，失败保留临时续传
          let final = taskTmpDir(p.id, p.folder, this.cfg.getLocalDir());
          pushKV(spec.argsName, final);
          break;
        }
        case "name": {
          // 任务创建时已 sanitize，这里防御性再洗一次（与 Go 一致）
          let name = sanitizeFilename(p.name);
          if (spec.postfix === "@@AUTO@@") {
            name = name + "." + guessExtFromURL(p.url);
          } else if (spec.postfix) {
            name = name + spec.postfix;
          }
          pushKV(spec.argsName, name);
          break;
        }
        case "headers":
          for (const h of p.headers) {
            for (const k of spec.argsName) out.push(k, h);
          }
          break;
        case "deleteSegments":
          pushKV(
            spec.argsName,
            this.cfg.getDeleteSegments() ? "true" : "false",
          );
          break;
        case "proxy":
          if (this.cfg.getUseProxy()) {
            const proxy = this.cfg.getProxy();
            if (proxy !== "") pushKV(spec.argsName, proxy);
          }
          break;
        // 通用引擎参数（direct/bt）：连接数/分片/分片大小/下载限速/重试——
        // 由下载中心「下载引擎」设置驱动（conf.aria2），热更新后新任务即生效
        case "aria2Common": {
          const o = this.cfg.getAria2Options();
          out.push(
            "--max-connection-per-server",
            String(clampNum(o.connections, 16, 1, 16)),
          );
          out.push("--split", String(clampNum(o.splits, 16, 1, 128)));
          out.push(
            "--min-split-size",
            sanitizeSpeedSize(o.minSplitSize, "1M", 1048576),
          );
          if (o.speedLimit)
            out.push(
              "--max-overall-download-limit",
              sanitizeSpeedSize(o.speedLimit, ""),
            );
          out.push("--max-tries", String(clampNum(o.maxTries, 5, 0, 99)));
          out.push("--retry-wait", String(clampNum(o.retryWait, 0, 0, 60)));
          break;
        }
        // BT 参数与种子文件勾选已随 bt 任务的 aria2 执行链退役（BT 走
        // qBittorrent Web API：参数在 downloadBtViaQbit 内设置）。
        // 此处仅保留 direct（普通文件）消费的 aria2Common 注入。
        case "__common__":
          out.push(...spec.argsName);
          break;
      }
    }
    return out;
  }

  /** 执行下载任务；signal abort → 抛 CanceledError（对应 Go ctx 取消） */
  async download(
    p: DownloadParams,
    cb: Callbacks,
    signal: AbortSignal,
  ): Promise<void> {
    logger.info(
      `Starting download task id=${p.id} type=${p.type} url=${p.url} name=${p.name}`,
    );

    // 入队后即被取消（start 后立即 stop）—— 不再启动外部进程
    if (signal.aborted) throw new CanceledError();

    // BT/磁力走 qBittorrent（专门 BT 栈），不再 spawn aria2c
    if (p.type === "bt") {
      logger.info(
        `Starting bt task id=${p.id} engine=qbittorrent url=${p.url.slice(0, 80)}`,
      );
      await this.downloadBtViaQbit(p, cb, signal);
      logger.info(`BT task completed id=${p.id}`);
      return;
    }

    const schema = getByType(this.schemas, p.type);
    if (!schema) {
      logger.error(`Unsupported download type id=${p.id} type=${p.type}`);
      throw new UnsupportedTypeError(p.type);
    }

    const bin = this.binMap[p.type];
    if (!bin) {
      logger.error(
        `Binary not configured for download type id=${p.id} type=${p.type}`,
      );
      throw new Error(`binary not configured for type "${p.type}"`);
    }
    if (!fs.existsSync(bin)) {
      logger.error(
        `Binary file not found on disk id=${p.id} type=${p.type} binary=${bin}`,
      );
      throw new Error(`binary "${bin}" not found for type "${p.type}"`);
    }
    logger.debug(`Using downloader binary id=${p.id} binary=${bin}`);

    const lp = new LineParser(schema.consoleReg);
    const args = this.buildArgs(p, schema);
    logger.debug(
      `Command arguments built id=${p.id} args=${JSON.stringify(args)}`,
    );

    const st: ParseState = {
      ready: false,
      percent: 0,
      speed: "",
      isLive: false,
    };

    const onLine = (raw: string) => {
      const line = raw.trim();
      if (line === "") return;
      cb.onMessage?.({ id: p.id, message: line });

      const [evt, errStr] = lp.parse(line, st);
      if (errStr) {
        logger.warn(`Parse error in download output id=${p.id} line=${line}`);
      }

      if (evt === "ready") {
        st.ready = true;
        logger.info(`Download ready id=${p.id} isLive=${st.isLive}`);
        cb.onProgress?.({
          id: p.id,
          type: "ready",
          percent: 0,
          speed: "",
          isLive: st.isLive,
        } satisfies ProgressEvent);
      }

      // 进度更新（节流 50ms）
      if (st.ready && (st.percent > 0 || st.speed !== "")) {
        if (this.tracker.shouldUpdate(p.id)) {
          logger.debug(
            `Download progress id=${p.id} percent=${st.percent} speed=${st.speed}`,
          );
          cb.onProgress?.({
            id: p.id,
            type: "progress",
            percent: st.percent,
            speed: st.speed,
            isLive: st.isLive,
          });
          this.tracker.update(p.id);
        }
      }
    };

    logger.info(`Executing download command id=${p.id} binary=${bin}`);
    try {
      await execRun(bin, args, onLine, signal);
      logger.info(`Download completed successfully id=${p.id}`);
    } catch (err: any) {
      logger.error(`Download failed id=${p.id}: ${err?.message ?? err}`);
      throw err;
    } finally {
      this.tracker.remove(p.id);
    }
  }
}
