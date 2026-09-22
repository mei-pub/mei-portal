// core/parser —— Go internal/core/parser 的复刻：5 正则解析 + 退格处理 + 进度节流

import type { ConsoleReg } from './schema.ts';

export interface ParseState {
  ready: boolean;
  percent: number;
  speed: string;
  isLive: boolean;
}

/** 处理退格字符，返回视觉显示的字符串（与 Go processBackspaces 一致） */
export function processBackspaces(s: string): string {
  const result: string[] = [];
  for (const ch of s) {
    if (ch === '\b') {
      if (result.length > 0) result.pop();
    } else {
      result.push(ch);
    }
  }
  return result.join('');
}

export class LineParser {
  private percentReg?: RegExp;
  private speedReg?: RegExp;
  private errorReg?: RegExp;
  private startReg?: RegExp;
  private isLiveReg?: RegExp;

  constructor(cr: ConsoleReg) {
    if (cr.percent) this.percentReg = new RegExp(cr.percent);
    if (cr.speed) this.speedReg = new RegExp(cr.speed);
    if (cr.error) this.errorReg = new RegExp(cr.error);
    if (cr.start) this.startReg = new RegExp(cr.start);
    if (cr.isLive) this.isLiveReg = new RegExp(cr.isLive);
  }

  /** 解析一行控制台输出；返回 [事件类型("ready"|""), 错误信息] */
  parse(line: string, state: ParseState): [string, string] {
    // 错误行
    if (this.errorReg?.test(line)) return ['', line];

    // 直播流标记
    if (this.isLiveReg?.test(line)) state.isLive = true;

    // 开始标记 → ready
    if (!state.ready && this.startReg?.test(line)) return ['ready', ''];

    // 进度百分比
    let matchedPercent = false;
    if (this.percentReg) {
      const processed = processBackspaces(line);
      const m = this.percentReg.exec(processed);
      if (m && m.length > 1) {
        const percent = Number.parseFloat(m[1]!);
        if (!Number.isNaN(percent)) {
          state.percent = percent;
          matchedPercent = true;
        }
      }
    }

    // 下载速度
    let matchedSpeed = false;
    if (this.speedReg) {
      const m = this.speedReg.exec(line);
      if (m && m.length > 1) {
        state.speed = m[1]!.trim();
        matchedSpeed = true;
      }
    }

    // 未 ready 但解析到进度/速度 → 自动进入 ready
    if (!state.ready && (matchedPercent || matchedSpeed)) {
      state.ready = true;
      return ['ready', ''];
    }

    return ['', ''];
  }
}

// ---- 进度节流（Go parser/tracker.go：50ms 内不重复上报）----

interface ProgressRecord {
  lastUpdate: number;
}

export class ProgressTracker {
  private records = new Map<string, ProgressRecord>();

  shouldUpdate(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec) return true;
    return Date.now() - rec.lastUpdate >= 50;
  }

  update(id: string): void {
    const rec = this.records.get(id);
    if (rec) rec.lastUpdate = Date.now();
    else this.records.set(id, { lastUpdate: Date.now() });
  }

  remove(id: string): void {
    this.records.delete(id);
  }
}
