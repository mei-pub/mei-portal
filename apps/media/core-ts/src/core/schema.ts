// core/schema —— Go internal/core/schema/loader.go 的复刻：DefaultSchemas 参数表 + JSON 覆盖

import fs from 'node:fs';
import { logger } from '../logger.ts';

export interface ArgSpec {
  /** 命令行参数名列表（多个则依次重复出现） */
  argsName: string[];
  /** 文件名后缀；"@@AUTO@@" 表示从 URL 推断扩展名 */
  postfix?: string;
}

export interface ConsoleReg {
  percent: string;
  speed: string;
  error: string;
  start: string;
  isLive: string;
}

export interface Schema {
  type: string;
  args: { [key: string]: ArgSpec };
  consoleReg: ConsoleReg;
}

export interface SchemaList {
  schemas: Schema[];
}

export function getByType(sl: SchemaList, t: string): Schema | undefined {
  return sl.schemas.find((s) => s.type === t);
}

/** 内置默认 Schema（与 Go DefaultSchemas / Node 版 config.json 逐条对齐） */
export function defaultSchemas(): SchemaList {
  return {
    schemas: [
      {
        type: 'm3u8',
        args: {
          url: { argsName: [] },
          localDir: { argsName: ['--tmp-dir', '--save-dir'] },
          name: { argsName: ['--save-name'] },
          headers: { argsName: ['--header'] },
          deleteSegments: { argsName: ['--del-after-done'] },
          proxy: { argsName: ['--custom-proxy'] },
          __common__: {
            argsName: [
              '--no-log', '--auto-select', '--ui-language', 'zh-CN',
              '--live-real-time-merge', '--check-segments-count', 'false',
            ],
          },
        },
        consoleReg: {
          percent: '([\\d.]+)%',
          speed: '([\\d.]+[GMK]Bps)',
          error: 'ERROR',
          start: '保存文件名:',
          isLive: '检测到直播流',
        },
      },
      {
        type: 'bilibili',
        args: {
          url: { argsName: [] },
          localDir: { argsName: ['--work-dir'] },
          name: { argsName: ['--file-pattern'] },
          __common__: { argsName: ['--use-app-api', '--encoding-priority', 'avc,hevc,av1'] },
        },
        consoleReg: {
          percent: '([\\d.]+)%',
          speed: '([\\d.]+\\s[GMK]B/s)',
          error: 'ERROR',
          start: '开始下载',
          isLive: '检测到直播流',
        },
      },
      {
        // direct 下载走 aria2c；-x/-s/-k 与旧 gopeed 配置一致（aria2 同名短参数）
        type: 'direct',
        args: {
          localDir: { argsName: ['-d'] },
          name: { argsName: ['-o'], postfix: '@@AUTO@@' },
          url: { argsName: [] },
          __common__: {
            argsName: [
              '-x', '16', '-s', '16', '-k', '1M',
              '--console-log-level=notice',
              '--summary-interval=1',
              '--allow-overwrite=true',
              '--auto-file-renaming=false',
              '--check-certificate=false',
            ],
          },
        },
        consoleReg: {
          percent: '\\((\\d+)%\\)',
          speed: 'DL:(\\S+)',
          error: 'errorCode=\\d+|exception',
          start: 'Download (started|Results:)',
          isLive: '',
        },
      },
      {
        type: 'youtube',
        args: {
          url: { argsName: [] },
          localDir: { argsName: ['-P'] },
          name: { argsName: ['-o'] },
          headers: { argsName: ['--add-header'] },
          proxy: { argsName: ['--proxy'] },
          __common__: { argsName: ['--no-mtime', '--progress', '--newline', '--no-colors'] },
        },
        consoleReg: {
          percent: '([\\d.]+)%',
          speed: '([\\d.]+\\s?[MKG]?i?B/s)',
          error: 'ERROR',
          start: '\\[download\\] Destination:',
          isLive: '\\[live\\]',
        },
      },
      {
        type: 'mediago',
        args: {
          url: { argsName: [] },
          localDir: { argsName: ['--save-dir', '--tmp-dir'] },
          name: { argsName: ['--save-name'] },
          headers: { argsName: ['--header'] },
          deleteSegments: { argsName: ['--del-after-done'] },
          proxy: { argsName: ['--proxy'] },
          __common__: { argsName: ['--auto-select', '--thread-count', '8'] },
        },
        consoleReg: {
          percent: '([\\d.]+)%',
          speed: '([\\d.]+\\s?[MKG]?B/s)',
          error: 'Error:',
          start: '\\[download\\] \\d+ segments',
          isLive: 'is_live:\\s*true|\\[live\\]',
        },
      },
    ],
  };
}

/**
 * 从 JSON 文件加载 Schema；文件不存在时返回内置默认值（与 Go LoadSchemasFromJSON 一致）。
 */
export function loadSchemasFromJSON(p: string): SchemaList {
  logger.debug(`Loading schemas from file: ${p}`);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const sl = JSON.parse(raw) as SchemaList;
    logger.info(`Schemas loaded successfully: ${p} count=${sl.schemas?.length ?? 0}`);
    return sl;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      logger.info(`Schema file not found, using built-in defaults: ${p}`);
      return defaultSchemas();
    }
    logger.error(`Failed to read/parse schema file: ${p}: ${err?.message ?? err}`);
    // Go 版解析失败直接 Fatal；这里保持一致 —— 让启动失败
    throw err;
  }
}
