/* eslint-disable no-console */

// 本地源服务端模块：
// 1. 记录存储（/data/tv/local-sources.json，原子写 + 损坏容错，跨设备共享）
// 2. 分类映射（豆瓣 type / CMS 分类字符串 → 电影/电视/动漫/综艺）
// 3. media 下载服务客户端（容器内直连 127.0.0.1:3000，X-API-Key 携带门户会话令牌）
//
// 纯逻辑（键、分类映射）与文件存储分离，便于 node:test 确定性测试。

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type {
  LocalSourceCategory,
  LocalSourceRecord,
  LocalSourceStatus,
} from './local-source.types';

// ---------------------------------------------------------------------------
// 纯逻辑：标题归一化 / 记录键
// ---------------------------------------------------------------------------

/** 标题归一化：去首尾空白 + 去全部空白 + 小写（中英文剧名的空格差异不应导致两套记录） */
export function normalizeTitle(title: string): string {
  return (title ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

/** 记录键：同一剧（归一化标题 + 年份）同一集幂等 */
export function recordKeyOf(
  title: string,
  year: string | undefined | null,
  episode: number
): string {
  return `${normalizeTitle(title)}|${(year ?? '').trim()}|e${episode}`;
}

/** 下载任务名：多集剧带集号（S01E03），电影用片名本身 */
export function downloadNameOf(
  title: string,
  episode: number,
  totalEpisodes: number
): string {
  const t = (title ?? '').trim();
  if (!totalEpisodes || totalEpisodes <= 1) return t;
  const ep = String(episode).padStart(2, '0');
  return `${t} S01E${ep}`;
}

// ---------------------------------------------------------------------------
// 纯逻辑：分类映射
// ---------------------------------------------------------------------------

export interface CategoryHints {
  /** 豆瓣 type（movie/tv/anime/show，来自播放页 stype 或豆瓣卡片） */
  doubanType?: string | null;
  /** CMS 分类字符串（detail.vod_class，如 "日本动漫"/"动作片"/"国产剧"/"大陆综艺"） */
  className?: string | null;
  /** 总集数（兜底判定：单集视为电影） */
  totalEpisodes?: number;
}

/**
 * 分类映射：豆瓣 type > CMS 分类字符串 > 集数兜底（<=1 电影，否则电视）。
 * 未知一律归电视（剧集类占多数，电影误归电视只是目录问题，不影响播放）。
 */
export function mapCategory(hints: CategoryHints): LocalSourceCategory {
  const dt = (hints.doubanType ?? '').trim().toLowerCase();
  if (dt) {
    if (dt === 'movie') return '电影';
    if (dt === 'tv') return '电视';
    if (dt === 'anime') return '动漫';
    if (dt === 'show') return '综艺';
  }

  const cls = (hints.className ?? '').trim();
  if (cls) {
    if (/动漫|动画|番剧|二次元|国创/.test(cls)) return '动漫';
    if (/综艺|真人秀|脱口秀|晚会/.test(cls)) return '综艺';
    // "剧情片/动作片/科幻片/纪录片" 等以「片」结尾均为电影子类
    if (/电影/.test(cls) || /片$/.test(cls)) return '电影';
    if (/剧|连续剧|电视剧/.test(cls)) return '电视';
  }

  if (hints.totalEpisodes !== undefined && hints.totalEpisodes <= 1) {
    return '电影';
  }
  return '电视';
}

// ---------------------------------------------------------------------------
// 纯逻辑：media 任务状态映射
// ---------------------------------------------------------------------------

/**
 * media 下载状态（ready/pending/downloading/success/failed/stopped）
 * → 本地源状态。success → done；failed/stopped → failed；其余仍在途。
 */
export function mapMediaStatus(mediaStatus: string): LocalSourceStatus | null {
  switch (mediaStatus) {
    case 'success':
      return 'done';
    case 'failed':
    case 'stopped':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'downloading':
      return 'downloading';
    default:
      return null; // ready 等未知值：保持原状态不动
  }
}

/** 下载任务类型：m3u8 链接走 N_m3u8DL-RE，其余直链走 aria2c */
export function mediaTaskTypeOf(url: string): 'm3u8' | 'direct' {
  return /\.m3u8(\?|$)/i.test(url ?? '') ? 'm3u8' : 'direct';
}

// ---------------------------------------------------------------------------
// 文件存储：/data/tv/local-sources.json
// ---------------------------------------------------------------------------

/** 本地源记录存储：内存缓存 + 原子写（tmp+rename）+ 损坏容错（坏文件改名让位） */
export class LocalSourceStore {
  private readonly filePath: string;
  private cache: Map<string, LocalSourceRecord> | null = null;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      path.join(process.env.DATA_DIR || '/data', 'tv', 'local-sources.json');
  }

  get path(): string {
    return this.filePath;
  }

  private async load(): Promise<Map<string, LocalSourceRecord>> {
    if (this.cache) return this.cache;
    let raw: string;
    try {
      raw = await fsp.readFile(this.filePath, 'utf8');
    } catch {
      this.cache = new Map();
      return this.cache;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, LocalSourceRecord>;
      const map = new Map<string, LocalSourceRecord>();
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object' && typeof v.key === 'string') {
          map.set(k, v);
        }
      }
      this.cache = map;
      return map;
    } catch (err) {
      // 损坏容错：改名隔离坏文件（保留现场），以空库继续，不让整条下载链路瘫痪
      try {
        await fsp.rename(
          this.filePath,
          `${this.filePath}.corrupt-${Date.now()}`
        );
      } catch {
        /* 改名失败（如只读）也不阻断：以空库继续 */
      }
      console.warn('local-sources.json 损坏，已隔离并重建空库:', err);
      this.cache = new Map();
      return this.cache;
    }
  }

  /** 原子写：tmp + rename，进程崩溃不会留下半截文件 */
  private async persist(map: Map<string, LocalSourceRecord>): Promise<void> {
    const obj: Record<string, LocalSourceRecord> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
    try {
      await fsp.rename(tmp, this.filePath);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
  }

  async listAll(): Promise<LocalSourceRecord[]> {
    const map = await this.load();
    const out: LocalSourceRecord[] = [];
    map.forEach((v) => out.push(v));
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** 按标题查（归一化比较；year 给定时同时匹配，记录 year 为空串视为通配） */
  async listByTitle(
    title: string,
    year?: string | null
  ): Promise<LocalSourceRecord[]> {
    const norm = normalizeTitle(title);
    const y = (year ?? '').trim();
    const map = await this.load();
    const out: LocalSourceRecord[] = [];
    map.forEach((rec) => {
      if (!rec.key.startsWith(`${norm}|`)) return;
      if (y && rec.year && rec.year !== y) return;
      out.push(rec);
    });
    out.sort((a, b) => a.episode - b.episode);
    return out;
  }

  async get(key: string): Promise<LocalSourceRecord | null> {
    const map = await this.load();
    return map.get(key) ?? null;
  }

  async upsert(record: LocalSourceRecord): Promise<LocalSourceRecord> {
    const map = await this.load();
    map.set(record.key, record);
    await this.persist(map);
    return record;
  }

  async remove(key: string): Promise<boolean> {
    const map = await this.load();
    if (!map.delete(key)) return false;
    await this.persist(map);
    return true;
  }
}

// ---------------------------------------------------------------------------
// media 下载服务客户端（容器内直连）
// ---------------------------------------------------------------------------

function mediaApiUrl(): string {
  return process.env.MEDIA_API_URL || 'http://127.0.0.1:3000';
}

function shellUserFile(): string {
  return process.env.MEI_SHELL_USER_FILE || '/data/shell/user.json';
}

let tokenCache = { value: '', exp: 0 };

/**
 * 门户会话令牌：sha256(`${username}:${hash}`)（与 media api/auth.ts 完全一致的算法）。
 * 30s 缓存；user.json 缺失/不合法时返回空串（调用方按 401 处理）。
 */
export async function portalMediaApiKey(): Promise<string> {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.exp) return tokenCache.value;
  let value = '';
  try {
    const raw = await fsp.readFile(shellUserFile(), 'utf8');
    const user = JSON.parse(raw) as { username?: string; hash?: string };
    if (user.username && user.hash) {
      value = crypto
        .createHash('sha256')
        .update(`${user.username}:${user.hash}`)
        .digest('hex');
    }
  } catch {
    value = '';
  }
  tokenCache = { value, exp: now + (value ? 30_000 : 5_000) };
  return value;
}

interface MediaEnvelope<T> {
  success: boolean;
  code: number;
  message?: string;
  data?: T;
}

async function mediaFetch<T>(
  urlPath: string,
  init?: RequestInit
): Promise<MediaEnvelope<T>> {
  const apiKey = await portalMediaApiKey();
  const res = await fetch(`${mediaApiUrl()}${urlPath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  let body: MediaEnvelope<T>;
  try {
    body = (await res.json()) as MediaEnvelope<T>;
  } catch {
    throw new Error(`media 服务响应异常 (${res.status})`);
  }
  if (!res.ok || !body.success) {
    throw new Error(body.message || `media 服务请求失败 (${res.status})`);
  }
  return body;
}

export interface MediaVideo {
  id: number;
  name: string | null;
  type: string;
  url: string;
  folder: string | null;
  status: string;
}

/** 创建并自动启动下载任务（media downloadCreate 支持 startDownload 批量自启） */
export async function createMediaDownload(input: {
  name: string;
  url: string;
  folder: string;
  type: 'm3u8' | 'direct';
  headers?: string[] | null;
}): Promise<MediaVideo> {
  const body = {
    tasks: [
      {
        name: input.name,
        type: input.type,
        url: input.url,
        headers: null,
        folder: input.folder,
      },
    ],
    startDownload: true,
  };
  const env = await mediaFetch<MediaVideo[]>('/api/downloads', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const video = env.data?.[0];
  if (!video) throw new Error('media 未返回下载任务');
  return video;
}

export interface MediaTaskInfo {
  id: string;
  status: string;
  percent: number;
  speed: string;
}

/** 查询下载任务的持久状态（DB 记录，服务重启后仍有值） */
export async function fetchMediaDownload(
  id: number
): Promise<MediaVideo | null> {
  try {
    const env = await mediaFetch<MediaVideo>(`/api/downloads/${id}`);
    return env.data ?? null;
  } catch (err) {
    // 404（任务被手动删除）等场景：吞掉，让调用方按「查不到进度」处理
    console.warn(`查询 media 下载任务失败 id=${id}:`, err);
    return null;
  }
}

/** 查询内存任务队列的瞬时进度（percent/speed；服务重启后 404 → null） */
export async function fetchMediaTaskProgress(
  id: number
): Promise<MediaTaskInfo | null> {
  try {
    const env = await mediaFetch<MediaTaskInfo>(`/api/tasks/${id}`);
    return env.data ?? null;
  } catch {
    return null;
  }
}
