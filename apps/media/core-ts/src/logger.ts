// logger —— Go internal/logger 的极简替代：级别过滤 + 控制台 + 每日文件

import fs from 'node:fs';
import path from 'node:path';

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

let currentLevel = 'info';
let logDir = './logs';

export function initLogger(level: string, dir: string): void {
  currentLevel = level in LEVELS ? level : 'info';
  logDir = dir;
  fs.mkdirSync(logDir, { recursive: true });
}

function line(tag: string, msg: string): string {
  const ts = new Date().toISOString();
  return `${ts}\t${tag.toUpperCase()}\t${msg}`;
}

function dailyFile(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return path.join(logDir, `mediago-core-${ymd}.log`);
}

function emit(level: string, msg: string): void {
  if (LEVELS[level]! < LEVELS[currentLevel]!) return;
  const l = line(level, msg);
  if (level === 'error' || level === 'fatal') process.stderr.write(l + '\n');
  else process.stdout.write(l + '\n');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(dailyFile(), l + '\n');
  } catch {
    // 日志文件不可写时只保留控制台输出
  }
}

export const logger = {
  debug: (msg: string) => emit('debug', msg),
  info: (msg: string) => emit('info', msg),
  warn: (msg: string) => emit('warn', msg),
  error: (msg: string) => emit('error', msg),
  fatal: (msg: string) => {
    emit('fatal', msg);
    process.exit(1);
  },
};
