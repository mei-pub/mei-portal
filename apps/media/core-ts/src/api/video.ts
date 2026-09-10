// api/video —— Go internal/video 的复刻：可播视频列表 + /videos/:id HTTP Range 流式播放

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VideoRepository, Video } from '../db.ts';
import { checkFileExists } from '../service/helpers.ts';

export interface PlayableVideo {
  id: number;
  title: string;
  url: string;
  mimeType: string;
}

// 常见视频扩展名 → MIME（等价 Go mime.TypeByExtension 可命中的部分；未命中回退 video/mp4）
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
};

function mimeFromPath(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? 'video/mp4';
}

function isVideoExt(p: string): boolean {
  return mimeFromPath(p).startsWith('video');
}

/** 播放器服务：基于下载记录 + 本地文件检查 */
export class VideoService {
  private readonly repo: VideoRepository;
  private readonly localPath: string;

  constructor(repo: VideoRepository, localPath: string) {
    this.repo = repo;
    this.localPath = localPath;
  }

  /** 找到下载记录对应的实际文件；目录形式（分段下载）时取其中第一个视频文件 */
  private resolveFilePath(rec: Video): string | null {
    let searchDir = this.localPath;
    if (rec.folder && rec.folder !== '') searchDir = path.join(this.localPath, rec.folder);
    const [exists, filePath] = checkFileExists(rec.name, searchDir);
    if (!exists) return null;
    try {
      if (fs.statSync(filePath).isDirectory()) {
        return findFirstVideoInDir(filePath);
      }
    } catch {
      return null;
    }
    return filePath;
  }

  /** 全部已成功下载且文件在盘的视频 */
  getVideoFiles(): PlayableVideo[] {
    const records = this.repo.findByStatus(['success']);
    const videos: PlayableVideo[] = [];
    for (const rec of records) {
      const filePath = this.resolveFilePath(rec);
      if (!filePath) continue;
      videos.push({ id: rec.id, title: rec.name, url: `/videos/${rec.id}`, mimeType: mimeFromPath(filePath) });
    }
    return videos;
  }

  getVideoByID(id: number): PlayableVideo | null {
    const rec = this.repo.findById(id);
    if (!rec) return null;
    if (rec.status !== 'success') return null;
    const filePath = this.resolveFilePath(rec);
    if (!filePath) return null;
    return { id: rec.id, title: rec.name, url: `/videos/${rec.id}`, mimeType: mimeFromPath(filePath) };
  }

  getVideoFilePath(id: number): string | null {
    const rec = this.repo.findById(id);
    if (!rec) return null;
    if (rec.status !== 'success') return null;
    return this.resolveFilePath(rec);
  }
}

function findFirstVideoInDir(dir: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (isVideoExt(entry.name)) return path.join(dir, entry.name);
  }
  return null;
}

/**
 * HTTP Range 流式播放（等价 gin c.File / http.ServeContent 的单段 Range 支持）。
 * 支持 GET（含 Range: bytes=start-end）；HEAD 返回头不带 body。
 */
export function serveVideoFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'video file not found' }));
    return;
  }

  const contentType = mimeFromPath(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? 0 : parseInt(m[1]!, 10);
      let end = m[2] === '' ? total - 1 : parseInt(m[2]!, 10);
      if (m[1] === '' && m[2] !== '') {
        // suffix range: bytes=-N → 最后 N 字节
        start = Math.max(0, total - parseInt(m[2]!, 10));
        end = total - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      if (end >= total) end = total - 1;
      const headers = {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      };
      res.writeHead(206, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }
    // Range 头不合法 → 忽略，按完整文件处理
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(total),
    'Accept-Ranges': 'bytes',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
