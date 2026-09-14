// core/downloader —— Go internal/core/downloader.go 的复刻：外部二进制执行下载，不重写下载算法

import path from "node:path";
import fs from "node:fs";
import { logger } from "../logger.ts";
import { execRun, CanceledError } from "./runner.ts";
import { LineParser, ProgressTracker, type ParseState } from "./parser.ts";
import { getByType, type Schema, type SchemaList } from "./schema.ts";
import type {
  Aria2Options,
  Callbacks,
  DownloadParams,
  DownloaderConfig,
  ProgressEvent,
} from "./types.ts";

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

/** 从 URL 推断扩展名（与 Go guessExtFromURL 一致） */
export function guessExtFromURL(u: string): string {
  const l = u.toLowerCase();
  if (l.includes(".m3u8")) return "m3u8";
  if (l.includes(".mp4")) return "mp4";
  if (l.includes(".flv")) return "flv";
  if (l.includes(".mkv")) return "mkv";
  return "mp4";
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
          let final = this.cfg.getLocalDir();
          // folder 为用户可控输入：先按段清洗，防御 ../ 逃出 localDir
          if (p.folder !== "")
            final = path.join(final, sanitizeFolder(p.folder));
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
        // BT 参数（磁力）：DHT/LPD/PEX 开关、监听端口、上传限速、最大 Peer、补充 tracker
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
          const trackers = splitList(b.trackers);
          if (trackers.length > 0) out.push("--bt-tracker", trackers.join(","));
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
