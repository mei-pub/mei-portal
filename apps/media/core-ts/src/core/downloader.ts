// core/downloader —— Go internal/core/downloader.go 的复刻：外部二进制执行下载，不重写下载算法

import path from "node:path";
import fs from "node:fs";
import { logger } from "../logger.ts";
import { execRun, CanceledError } from "./runner.ts";
import { extractTorrentMeta, torrentInfoHash } from "./bencode.ts";
import { LineParser, ProgressTracker, type ParseState } from "./parser.ts";
import { getByType, type Schema, type SchemaList } from "./schema.ts";
import type {
  Aria2Options,
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

// ---- 磁力元数据加速（对齐迅雷「秒出」体验的公开手段）----
// 冷启动的新 aria2c 进程：无 DHT 路由表（bootstrap 10-30s）、无 tracker，
// 是磁力解析超时的根因。三件套加速：
// 1) 结果缓存：同 infohash 之前解析过 → 直接返回 torrents/<hash>.torrent
// 2) 公共 tracker：aria2 --bt-tracker 并行 announce（与链接自带 tr、用户设置合并）
// 3) DHT 路由表持久化（--dht-file-path）+ 显式引导节点（--dht-entry-point）：
//    进程退出保存路由表，下次秒级查表

const PUBLIC_BT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.io:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
];

/** DHT 引导节点（冷启动显式 ping，快于默认配置的被动发现） */
const DHT_ENTRY_POINT = "router.bittorrent.com:6881";

/**
 * 公共 torrent 缓存（秒级第一跳，对齐迅雷「云索引秒出」的公开等价物）：
 * 按 infohash 直取 .torrent（HTTP 1-2s）。itorrents（torcache 继任者，
 * WebTorrent/instant.io 生态使用）。返回体必须能 bencode 解析且 infohash
 * 与磁力 btih 一致（防缓存污染 / 错内容）；拉不到立即回落 aria2。
 */
const TORRENT_CACHE_URLS = [
  (h: string) => `https://itorrents.org/torrent/${h.toUpperCase()}.torrent`,
];

async function fetchTorrentCache(
  url: string,
  timeoutMs = 4000,
): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null; // 网络不通 / 超时：回落 aria2 路径
  }
}

/** 用户 trackers（conf）∪ 公共 tracker —— 磁力解析与 BT 下载共用兜底 */
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
   * 磁力链接元数据解析（任务创建前的强制内容识别）：
   * aria2c --bt-metadata-only + --bt-save-metadata 只连 DHT 取 metadata 并存成
   * <InfoHash>.torrent 到 torrentsDir（不下载任何数据块），外层 timeoutMs 超时
   * 强杀。返回落盘的 .torrent 路径 —— 它可直接作为 bt 任务 url（白名单内），
   * 任务执行时 aria2 不再二次取 metadata。
   */
  async resolveMagnet(
    magnet: string,
    torrentsDir: string,
    timeoutMs = 45000,
  ): Promise<string> {
    const bin = this.binMap["bt"];
    if (!bin || !fs.existsSync(bin)) {
      throw new Error("aria2c binary not configured for magnet resolve");
    }
    const hashMatch = /urn:btih:([0-9a-fA-F]{40})/i.exec(magnet);
    if (!hashMatch) {
      throw new Error("invalid magnet link (missing 40-hex btih)");
    }
    const infoHash = hashMatch[1]!.toLowerCase();
    fs.mkdirSync(torrentsDir, { recursive: true });
    const target = path.join(torrentsDir, `${infoHash}.torrent`);

    // 结果缓存：同 infohash 解析过 → 秒回（重试 / 去重 / 跨会话都受益）
    if (fs.existsSync(target)) {
      return target;
    }

    // 第一跳：公共 torrent 缓存按 infohash 直取（秒级）；
    // 校验可解析 + infohash 一致后落盘即返回
    for (const mk of TORRENT_CACHE_URLS) {
      const buf = await fetchTorrentCache(mk(infoHash));
      if (!buf) continue;
      try {
        extractTorrentMeta(buf);
        const hash = torrentInfoHash(buf);
        if (hash === infoHash) {
          fs.writeFileSync(target, buf);
          logger.info(`magnet resolved via torrent cache: ${infoHash}`);
          return target;
        }
        logger.warn(
          `torrent cache infohash mismatch: got=${hash} want=${infoHash}`,
        );
      } catch {
        // 非 bencode 响应：试下一个源
      }
    }

    const trackers = mergedTrackers(this.cfg.getAria2Options().bt.trackers);
    const dhtFile = this.cfg.getDhtFile?.() ?? "";
    const args = [
      magnet,
      "-d",
      torrentsDir,
      "--bt-metadata-only=true",
      "--bt-save-metadata=true",
      // 公共 tracker + 用户 tracker 并行 announce（链接自带 tr 同样生效）
      "--bt-tracker",
      trackers,
      ...dhtArgs(dhtFile),
      // 网络超时压短：慢 tracker / 死 peer 快速放弃换下一个（aria2 默认 60s，
      // 是磁力解析拖到数十秒的隐性原因）
      "--bt-tracker-timeout=5",
      "--bt-tracker-connect-timeout=5",
      "--connect-timeout=10",
      "--timeout=15",
      // 无 peer 供 metadata 时放弃（外层 timeout 之外的第二道保险；
      // 30s 给 DHT/tracker 慢 announce 留余地）
      "--bt-stop-timeout=30",
      "--seed-time=0",
      "--console-log-level=notice",
      "--summary-interval=0",
    ];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      await execRun(
        bin,
        args,
        (line) => logger.debug(`resolve-magnet: ${line}`),
        ac.signal,
      );
    } catch (err: any) {
      if (err instanceof CanceledError || err?.message === "exit status 7") {
        // 外层超时强杀 / aria2 bt-stop-timeout 无数据提前退出（exit 7）：
        // 都统一为对用户可理解的「未找到可用节点」
        throw new Error("磁力解析超时（未找到可用节点）");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!fs.existsSync(target)) {
      throw new Error("磁力解析未产出种子文件（资源可能已失效）");
    }
    return target;
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
        // BT 参数（磁力）：DHT/LPD/PEX 开关、监听端口、上传限速、最大 Peer、tracker
        // tracker：用户设置 ∪ 公共 tracker 兜底（DHT 慢启动补救）；DHT 路由表
        // 持久化 + 显式引导节点（与 resolve-magnet 共享同一张表，越用越快）
        case "aria2Bt": {
          const b = this.cfg.getAria2Options().bt;
          out.push("--enable-dht=" + (b.enableDht ? "true" : "false"));
          out.push("--bt-enable-lpd=" + (b.enableLpd ? "true" : "false"));
          out.push(
            "--enable-peer-exchange=" + (b.enablePex ? "true" : "false"),
          );
          const port = sanitizePortRange(b.listenPort);
          if (port) {
            out.push("--listen-port", port);
            out.push("--dht-listen-port", port);
          }
          if (b.uploadLimit)
            out.push(
              "--max-overall-upload-limit",
              sanitizeSpeedSize(b.uploadLimit, ""),
            );
          out.push("--bt-max-peers", String(clampNum(b.maxPeers, 55, 1, 999)));
          // tracker：用户设置 ∪ 公共 tracker 兜底（只加 announce 源，无副作用）
          out.push("--bt-tracker", mergedTrackers(b.trackers));
          // DHT 开启时注入路由表持久化 + 引导节点（关闭时无意义）
          if (b.enableDht) out.push(...dhtArgs(this.cfg.getDhtFile?.() ?? ""));
          break;
        }
        // 种子文件勾选下载：--select-file 仅在 UI 解析出内容清单并勾选后携带；
        // 空/缺省（磁力任务、全量下载）不注入
        case "selectFile": {
          const sel = (p.selectFile ?? "").trim();
          if (sel !== "") pushKV(spec.argsName, sel);
          break;
        }
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
