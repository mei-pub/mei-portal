// core/downloader —— Go internal/core/downloader.go 的复刻：外部二进制执行下载，不重写下载算法

import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logger.ts';
import { execRun } from './runner.ts';
import { LineParser, ProgressTracker, type ParseState } from './parser.ts';
import { getByType, type Schema, type SchemaList } from './schema.ts';
import type { Callbacks, DownloadParams, DownloaderConfig, ProgressEvent } from './types.ts';

export class UnsupportedTypeError extends Error {
  readonly taskType: string;
  constructor(taskType: string) {
    super(`unsupported download type: "${taskType}"`);
    this.name = 'UnsupportedTypeError';
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
  if (name === '') return 'download';
  const out: string[] = [];
  for (const r of name) {
    const code = r.codePointAt(0)!;
    if (code < 0x20) continue; // 控制字符 → 丢弃
    if ('\\/:*?"<>|'.includes(r)) out.push('_');
    else out.push(r);
  }
  const cleaned = out.join('').replace(/[. ]+$/, '');
  if (cleaned === '') return 'download';
  return cleaned;
}

/** 从 URL 推断扩展名（与 Go guessExtFromURL 一致） */
export function guessExtFromURL(u: string): string {
  const l = u.toLowerCase();
  if (l.includes('.m3u8')) return 'm3u8';
  if (l.includes('.mp4')) return 'mp4';
  if (l.includes('.flv')) return 'flv';
  if (l.includes('.mkv')) return 'mkv';
  return 'mp4';
}

export class DownloaderSvc {
  private readonly binMap: { [t: string]: string };
  private readonly schemas: SchemaList;
  private readonly tracker = new ProgressTracker();
  private readonly cfg: DownloaderConfig;

  constructor(binMap: { [t: string]: string }, schemas: SchemaList, cfg: DownloaderConfig) {
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
        case 'url':
          if (spec.argsName.length > 0) out.push(...spec.argsName);
          out.push(p.url);
          break;
        case 'localDir': {
          let final = this.cfg.getLocalDir();
          if (p.folder !== '') final = path.join(final, p.folder);
          pushKV(spec.argsName, final);
          break;
        }
        case 'name': {
          // 任务创建时已 sanitize，这里防御性再洗一次（与 Go 一致）
          let name = sanitizeFilename(p.name);
          if (spec.postfix === '@@AUTO@@') {
            name = name + '.' + guessExtFromURL(p.url);
          } else if (spec.postfix) {
            name = name + spec.postfix;
          }
          pushKV(spec.argsName, name);
          break;
        }
        case 'headers':
          for (const h of p.headers) {
            for (const k of spec.argsName) out.push(k, h);
          }
          break;
        case 'deleteSegments':
          pushKV(spec.argsName, this.cfg.getDeleteSegments() ? 'true' : 'false');
          break;
        case 'proxy':
          if (this.cfg.getUseProxy()) {
            const proxy = this.cfg.getProxy();
            if (proxy !== '') pushKV(spec.argsName, proxy);
          }
          break;
        case '__common__':
          out.push(...spec.argsName);
          break;
      }
    }
    return out;
  }

  /** 执行下载任务；signal abort → 抛 CanceledError（对应 Go ctx 取消） */
  async download(p: DownloadParams, cb: Callbacks, signal: AbortSignal): Promise<void> {
    logger.info(`Starting download task id=${p.id} type=${p.type} url=${p.url} name=${p.name}`);

    const schema = getByType(this.schemas, p.type);
    if (!schema) {
      logger.error(`Unsupported download type id=${p.id} type=${p.type}`);
      throw new UnsupportedTypeError(p.type);
    }

    const bin = this.binMap[p.type];
    if (!bin) {
      logger.error(`Binary not configured for download type id=${p.id} type=${p.type}`);
      throw new Error(`binary not configured for type "${p.type}"`);
    }
    if (!fs.existsSync(bin)) {
      logger.error(`Binary file not found on disk id=${p.id} type=${p.type} binary=${bin}`);
      throw new Error(`binary "${bin}" not found for type "${p.type}"`);
    }
    logger.debug(`Using downloader binary id=${p.id} binary=${bin}`);

    const lp = new LineParser(schema.consoleReg);
    const args = this.buildArgs(p, schema);
    logger.debug(`Command arguments built id=${p.id} args=${JSON.stringify(args)}`);

    const st: ParseState = { ready: false, percent: 0, speed: '', isLive: false };

    const onLine = (raw: string) => {
      const line = raw.trim();
      if (line === '') return;
      cb.onMessage?.({ id: p.id, message: line });

      const [evt, errStr] = lp.parse(line, st);
      if (errStr) {
        logger.warn(`Parse error in download output id=${p.id} line=${line}`);
      }

      if (evt === 'ready') {
        st.ready = true;
        logger.info(`Download ready id=${p.id} isLive=${st.isLive}`);
        cb.onProgress?.({
          id: p.id,
          type: 'ready',
          percent: 0,
          speed: '',
          isLive: st.isLive,
        } satisfies ProgressEvent);
      }

      // 进度更新（节流 50ms）
      if (st.ready && (st.percent > 0 || st.speed !== '')) {
        if (this.tracker.shouldUpdate(p.id)) {
          logger.debug(`Download progress id=${p.id} percent=${st.percent} speed=${st.speed}`);
          cb.onProgress?.({
            id: p.id,
            type: 'progress',
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
