// core/downloader —— 视频站流媒体下载的外部二进制执行层（不重写下载算法）。
// direct（http/ftp/ed2k）与 BT/磁力已全链路切换到 FluxDown 引擎
//（service/engine 桥接：动态分段加速 + librqbit BT 栈），本层只保留
// N_m3u8DL-RE / BBDown / yt-dlp / mediago 的 spawn 执行与 stdout 进度解析。

import path from "node:path";
import fs from "node:fs";
import { logger } from "../logger.ts";
import { execRun, CanceledError } from "./runner.ts";
import { LineParser, ProgressTracker, type ParseState } from "./parser.ts";
import { getByType, type Schema, type SchemaList } from "./schema.ts";
import type {
  Callbacks,
  DownloadParams,
  DownloaderConfig,
  ProgressEvent,
} from "./types.ts";

export type { DownloaderConfig } from "./types.ts";

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
  const raw = (folder ?? "").trim();
  // 浏览器选择的下载根相对路径（"/" = 下载根本身，"// 子树"）：保存目录
  // 浏览器（daemon.fs.list）的产物。原始值先行判定——sanitizeFolder 会剥掉
  // 前导斜杠；段级清洗依旧生效（../ 逃逸被剔除，落点不会出 /downloads）
  if (raw.startsWith("/")) {
    return path.join(downloadRoot(localDir), sanitizeFolder(raw));
  }
  const f = sanitizeFolder(raw);
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
  // 根相对形态（保存目录浏览器产物）保留单个前导斜杠："/" = 下载根、
  // "/x/y" = 下载根下子树（resolveTaskDir 以 startsWith("/") 先行判定）。
  // 段级清洗依旧生效（../ 逃逸段被剔除），落点不会出 /downloads
  const raw = folder.trim();
  const rootRelative = raw.startsWith("/");
  const parts = raw
    .split(/[\\/]+/)
    .filter((p) => p !== "" && p !== "." && p !== "..");
  const joined = parts.join("/");
  return rootRelative ? `/${joined}` : joined;
}

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

    // 引擎类型（direct/bt）必须经 service 层路由到 FluxDown 桥接——
    // 走到这里是路由错误，显式报错防静默空转
    if (p.type === "bt" || p.type === "direct") {
      throw new Error(
        `type "${p.type}" is engine-routed (FluxDown); queue execution unreachable`,
      );
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
