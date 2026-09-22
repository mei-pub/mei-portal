// Conf —— Go pkg/conf 的复刻：JSON 文件持久化 + 原子写 + dotpath 读写 + 变更监听 + 文件轮询热加载

import fs from 'node:fs';
import path from 'node:path';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type ConfData = { [key: string]: Json | undefined };

interface ChangeListener {
  id: number;
  key: string;
  fn: (newVal: unknown, oldVal: unknown) => void;
}

export interface ConfOptions {
  /** 配置文件名（不含扩展名），默认 "config" */
  configName?: string;
  /** 配置目录，默认当前工作目录 */
  cwd?: string;
  /** 扩展名，默认 "json" */
  fileExtension?: string;
  /** 初始默认值（文件中缺失的键会回填默认值） */
  defaults: Record<string, unknown>;
}

// ---- dotpath（Go pkg/conf/dotpath.go）----

export function dotGet(data: ConfData, key: string): unknown {
  let current: unknown = data;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as ConfData)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

export function dotSet(data: ConfData, key: string, value: unknown): void {
  const parts = key.split('.');
  if (parts.length === 1) {
    data[key] = value as Json;
    return;
  }
  let current = data;
  for (const part of parts.slice(0, -1)) {
    let next = current[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      next = {};
      current[part] = next as Json;
    }
    current = next as ConfData;
  }
  current[parts[parts.length - 1]!] = value as Json;
}

export function dotDelete(data: ConfData, key: string): void {
  const parts = key.split('.');
  if (parts.length === 1) {
    delete data[key];
    return;
  }
  let current: unknown = data;
  for (const part of parts.slice(0, -1)) {
    if (current === null || typeof current !== 'object') return;
    current = (current as ConfData)[part];
  }
  if (current !== null && typeof current === 'object') {
    delete (current as ConfData)[parts[parts.length - 1]!];
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeMaps(dst: ConfData, src: ConfData): ConfData {
  const result: ConfData = { ...dst };
  for (const [k, v] of Object.entries(src)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const dstV = result[k];
      if (dstV !== null && typeof dstV === 'object' && !Array.isArray(dstV)) {
        result[k] = mergeMaps(dstV as ConfData, v as ConfData) as Json;
        continue;
      }
    }
    result[k] = v;
  }
  return result;
}

/** 文件级配置存储（与 Go conf.Conf 语义一致：文件值优先于默认值） */
export class Conf {
  private readonly filePath: string;
  private readonly defaults: Record<string, unknown>;
  private data: ConfData;
  private listeners: ChangeListener[] = [];
  private nextID = 0;
  private watching = false;

  constructor(opts: ConfOptions) {
    const configName = opts.configName || 'config';
    const ext = opts.fileExtension || 'json';
    const cwd = opts.cwd || process.cwd();
    this.filePath = path.join(cwd, `${configName}.${ext}`);
    this.defaults = opts.defaults;
    const defaultsMap = JSON.parse(JSON.stringify(opts.defaults)) as ConfData;

    // 读取现有文件（存在且合法时，默认值作为底层、文件值覆盖）
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const fileMap = JSON.parse(raw) as ConfData;
      this.data = mergeMaps(defaultsMap, fileMap);
      this.startWatch();
      return;
    } catch {
      // 文件不存在或非法 JSON —— 用默认值并落盘初始配置
    }
    this.data = defaultsMap;
    this.write();
    this.startWatch();
  }

  get(key: string): unknown {
    return dotGet(this.data, key);
  }

  async set(key: string, value: unknown): Promise<void> {
    const oldVal = dotGet(this.data, key);
    const snapshot = this.snapshot();
    dotSet(this.data, key, value);
    try {
      this.write();
    } catch (err) {
      // 落盘失败回滚内存，避免内存与磁盘长期分歧
      this.data = snapshot;
      throw err;
    }
    const calls = this.listeners.filter((l) => l.key === key).map((l) => ({ fn: l.fn, newVal: value, oldVal }));
    for (const c of calls) c.fn(c.newVal, c.oldVal);
  }

  async delete(key: string): Promise<void> {
    const snapshot = this.snapshot();
    dotDelete(this.data, key);
    try {
      this.write();
    } catch (err) {
      this.data = snapshot;
      throw err;
    }
  }

  /** 返回整个配置（深拷贝） */
  store(): ConfData {
    return JSON.parse(JSON.stringify(this.data)) as ConfData;
  }

  async setStore(store: Record<string, unknown>): Promise<void> {
    const snapshot = this.snapshot();
    const newMap = JSON.parse(JSON.stringify(store)) as ConfData;
    const oldData = this.data;
    this.data = newMap;
    try {
      this.write();
    } catch (err) {
      this.data = snapshot;
      throw err;
    }
    for (const l of this.listeners) {
      l.fn(dotGet(newMap, l.key), dotGet(oldData, l.key));
    }
  }

  /** 合并部分更新（只更新给出的键） */
  async update(partial: Record<string, unknown>): Promise<void> {
    const calls: Array<{ fn: (a: unknown, b: unknown) => void; newVal: unknown; oldVal: unknown }> = [];
    const snapshot = this.snapshot();
    for (const [key, value] of Object.entries(partial)) {
      const oldVal = dotGet(this.data, key);
      dotSet(this.data, key, value);
      for (const l of this.listeners) {
        if (l.key === key) calls.push({ fn: l.fn, newVal: value, oldVal });
      }
    }
    try {
      this.write();
    } catch (err) {
      this.data = snapshot;
      throw err;
    }
    for (const c of calls) c.fn(c.newVal, c.oldVal);
  }

  onDidChange(key: string, fn: (newVal: unknown, oldVal: unknown) => void): () => void {
    const id = this.nextID++;
    this.listeners.push({ id, key, fn });
    return () => {
      this.listeners = this.listeners.filter((l) => l.id !== id);
    };
  }

  path(): string {
    return this.filePath;
  }

  private snapshot(): ConfData {
    return JSON.parse(JSON.stringify(this.data)) as ConfData;
  }

  /** 重读磁盘并触发值有变化的监听器（外部编辑 config.json 后热生效）。
   *  与构造器一致地合并默认值：外部编辑器可能只写部分键，
   *  若直接以文件内容替换内存，缺失键的默认值会被整体丢掉。 */
  async reload(): Promise<void> {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const fileMap = JSON.parse(raw) as ConfData;
    const defaultsMap = JSON.parse(JSON.stringify(this.defaults)) as ConfData;
    const newMap = mergeMaps(defaultsMap, fileMap);
    const oldData = this.data;
    this.data = newMap;
    const calls: Array<{ fn: (a: unknown, b: unknown) => void; newVal: unknown; oldVal: unknown }> = [];
    for (const l of this.listeners) {
      const oldV = dotGet(oldData, l.key);
      const newV = dotGet(newMap, l.key);
      if (!deepEqual(oldV, newV)) calls.push({ fn: l.fn, newVal: newV, oldVal: oldV });
    }
    for (const c of calls) c.fn(c.newVal, c.oldVal);
  }

  /** 原子写：临时文件 + rename（与 Go write() 一致） */
  private write(): void {
    const data = JSON.stringify(this.data, null, 2);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    try {
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    this.startWatch();
  }

  /** 文件变更监听：fs.watchFile 轮询（stat 轮询，2s 间隔） */
  private startWatch(): void {
    if (this.watching || !fs.existsSync(this.filePath)) return;
    this.watching = true;
    fs.watchFile(
      this.filePath,
      { interval: 2000 },
      () => {
        // 自己的写入也会触发；reload 只在值真正变化时才通知监听器
        this.reload().catch(() => {});
      },
    );
  }
}
