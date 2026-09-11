/* eslint-disable no-console */

// 本地源落盘文件管理（/downloads/movie/<分类>/<剧名>/<剧名> S01Exx.<ext>）：
// - 纯逻辑：路径段清洗 / 防穿越 / 集号模糊匹配 / 同剧末集目录判定
// - fs 操作：列出 / 删除该集文件、统计大小、清空剧目录（thin wrapper，可临时目录测试）
//
// 防穿越双保险：
// 1. sanitizeSegment 拒绝空段 / "." / ".." / 含路径分隔符 / 控制字符
// 2. deletionPlanFor 在 path.resolve 后强制校验结果目录严格位于 root 之下
// 即使未来 sanitize 放宽，第 2 层也不会放行越界路径。

import fsp from 'node:fs/promises';
import path from 'node:path';

// 注意：本文件被 node:test（--experimental-strip-types）直接加载，
// 运行时 import 必须带 .ts 扩展而 tsc 又禁止带扩展 —— 故不引入本地运行时模块，
// 仅保留 type-only import（会被剥离，无解析问题）。

import type { LocalSourceRecord } from './local-source.types';

/** 影视下载落盘根目录（容器内与 media 服务共享 /downloads 卷） */
export function movieDownloadRoot(): string {
  return process.env.MEI_MOVIE_DIR || '/downloads/movie';
}

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mkv',
  'flv',
  'ts',
  'mov',
  'avi',
  'webm',
  'm4v',
  'm2ts',
]);

/** 路径段清洗：非法（空 / . / .. / 含分隔符 / 控制字符）返回 null，绝不参与拼路径 */
export function sanitizeSegment(seg: string): string | null {
  const s = (seg ?? '').trim();
  if (!s || s === '.' || s === '..') return null;
  if (/[\\/]/.test(s)) return null;
  if (/[\x00-\x1f]/.test(s)) return null;
  return s;
}

/** 仅允许删除/统计媒体扩展名（排除 .aria2 / .tmp 等下载中间产物与文本） */
export function isMediaFile(name: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return !!m && MEDIA_EXTENSIONS.has(m[1].toLowerCase());
}

/**
 * 集号模糊匹配正则：<剧名> S01E02.mp4 等。
 * 单集（totalEpisodes <= 1，电影）返回 null → 目录内任意媒体文件即该“集”。
 * 0* 容忍 padStart 差异（E2/E02），(?![0-9]) 防 E02 命中 E023。
 */
export function episodeRegexFor(record: LocalSourceRecord): RegExp | null {
  if (!record.totalEpisodes || record.totalEpisodes <= 1) return null;
  return new RegExp(`s01e0*${record.episode}(?![0-9])`, 'i');
}

/** 文件名是否为该记录对应的落盘文件（媒体扩展 + 集号模糊匹配） */
export function matchesEpisodeFile(
  name: string,
  record: LocalSourceRecord
): boolean {
  if (!isMediaFile(name)) return false;
  const rx = episodeRegexFor(record);
  return rx ? rx.test(name) : true;
}

export interface DeletionPlan {
  /** 剧目录绝对路径（resolve 后必位于 root 之下） */
  seriesDir: string;
}

/**
 * 构造删除/统计路径：<root>/<分类>/<剧名>。
 * 任一段非法或 resolve 后越出 root → null（拒绝执行，防穿越）。
 */
export function deletionPlanFor(
  root: string,
  record: LocalSourceRecord
): DeletionPlan | null {
  const category = sanitizeSegment(record.category);
  const title = sanitizeSegment(record.title);
  if (!category || !title) return null;
  const rootAbs = path.resolve(root);
  const dir = path.resolve(rootAbs, category, title);
  // 双保险：resolve 后必须严格位于 root 之下（拒绝 ../ 等任何形式的越界）
  if (!dir.startsWith(rootAbs + path.sep)) return null;
  return { seriesDir: dir };
}

/**
 * 同剧记录键前缀：`${归一剧名}|${年份}|`。
 * 记录键本身即 `${归一剧名}|${year}|e${集}`，直接取键前缀，
 * 避免重复（或不一致地重放）normalizeTitle 的归一逻辑。
 */
export function seriesKeyPrefixOf(record: LocalSourceRecord): string {
  const idx = record.key.lastIndexOf('|e');
  if (idx > 0) return record.key.slice(0, idx + 1);
  // 键格式异常（历史/伪造数据）时兜底原始拼接，仅用于分组判定、不参与路径
  return `${record.title}|${(record.year ?? '').trim()}|`;
}

/** 删除某记录后，同剧是否已无其他记录 → 允许清掉整个剧目录 */
export function shouldRemoveSeriesDir(
  remainingRecords: { key: string }[],
  removed: LocalSourceRecord
): boolean {
  const prefix = seriesKeyPrefixOf(removed);
  return !remainingRecords.some((r) => r.key.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// fs 操作（thin wrapper；路径全部经由 deletionPlanFor 校验）
// ---------------------------------------------------------------------------

/** 列出该记录对应的落盘媒体文件（相对文件名；目录不存在返回空）。路径非法抛错。 */
export async function listEpisodeFiles(
  root: string,
  record: LocalSourceRecord
): Promise<string[]> {
  const plan = deletionPlanFor(root, record);
  if (!plan) throw new Error(`记录路径非法，拒绝访问: ${record.key}`);
  let entries: string[];
  try {
    entries = await fsp.readdir(plan.seriesDir);
  } catch {
    return []; // 目录不存在 / 不可读：视为无文件，交由调用方按需处理
  }
  return entries.filter((n) => matchesEpisodeFile(n, record));
}

/** 删除该集落盘文件，返回被删的相对文件名。路径非法抛错（绝不执行越界删除）。 */
export async function removeEpisodeFiles(
  root: string,
  record: LocalSourceRecord
): Promise<string[]> {
  const plan = deletionPlanFor(root, record);
  if (!plan) throw new Error(`记录路径非法，拒绝删除: ${record.key}`);
  const targets = await listEpisodeFiles(root, record);
  for (const name of targets) {
    await fsp.rm(path.join(plan.seriesDir, name), { force: true });
  }
  return targets;
}

/** 统计该集落盘文件总字节数（管理页展示用；目录不存在返回 null） */
export async function episodeFilesSize(
  root: string,
  record: LocalSourceRecord
): Promise<number | null> {
  const plan = deletionPlanFor(root, record);
  if (!plan) return null;
  const files = await listEpisodeFiles(root, record);
  if (files.length === 0) return null;
  let total = 0;
  for (const name of files) {
    try {
      const st = await fsp.stat(path.join(plan.seriesDir, name));
      total += st.size;
    } catch {
      /* 单文件消失不影响合计 */
    }
  }
  return total;
}

/** 删除整个剧目录（同剧末集记录移除后调用）。路径非法抛错。 */
export async function removeSeriesDir(
  root: string,
  record: LocalSourceRecord
): Promise<void> {
  const plan = deletionPlanFor(root, record);
  if (!plan) throw new Error(`记录路径非法，拒绝删除目录: ${record.key}`);
  await fsp.rm(plan.seriesDir, { recursive: true, force: true });
}
