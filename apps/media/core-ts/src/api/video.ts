// api/video —— Go internal/video 的复刻：可播视频列表 + /videos/:id HTTP Range 流式播放

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VideoRepository, Video } from "../db.ts";
import { sanitizeFolder } from "../core/downloader.ts";
import { checkFileExists } from "../service/helpers.ts";

export interface PlayableVideo {
  id: number;
  title: string;
  url: string;
  mimeType: string;
}

// 常见视频扩展名 → MIME（等价 Go mime.TypeByExtension 可命中的部分；未命中回退 video/mp4）
const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",
  ".mkv": "video/x-matroska",
  ".ts": "video/mp2t",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".3gp": "video/3gpp",
};

function mimeFromPath(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? "video/mp4";
}

/**
 * 是否视频扩展名：只认显式映射（与 Go mime.TypeByExtension + "video/" 前缀判断对齐）。
 * 不能走 mimeFromPath 的 video/mp4 兜底 —— 否则 .txt/.jpg 等未知扩展也会被判成视频，
 * findFirstVideoInDir 会把分段目录里的封面图/说明文件当成正片返回。
 */
function isVideoExt(p: string): string | null {
  const t = MIME[path.extname(p).toLowerCase()];
  return t && t.startsWith("video") ? t : null;
}

/** 播放器服务：基于下载记录 + 本地文件检查 */
export class VideoService {
  private readonly repo: VideoRepository;
  /** localDir 经闭包读取（配置热更新 local 后流式路径立即跟随，而非只在启动时定格） */
  private readonly localDir: () => string;

  constructor(repo: VideoRepository, localDir: () => string) {
    this.repo = repo;
    this.localDir = localDir;
  }

  /** 找到下载记录对应的实际文件；目录形式（分段下载）时取其中第一个视频文件 */
  private resolveFilePath(rec: Video): string | null {
    let searchDir = this.localDir();
    // folder 为用户可控：按段清洗，防止 ../ 逃出 localDir 读任意文件（/videos/:id 免鉴权）
    if (rec.folder && rec.folder !== "")
      searchDir = path.join(this.localDir(), sanitizeFolder(rec.folder));
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

  /** 全部已成功下载且文件在盘的视频（可播列表；非视频文件跳过——普通下载
   *  产物（zip/iso 等）不可播，附件下载走 /files/:id） */
  getVideoFiles(): PlayableVideo[] {
    const records = this.repo.findByStatus(["success"]);
    const videos: PlayableVideo[] = [];
    for (const rec of records) {
      const filePath = this.resolveFilePath(rec);
      if (!filePath) continue;
      if (!isVideoExt(filePath)) continue;
      videos.push({
        id: rec.id,
        title: rec.name,
        url: `/videos/${rec.id}`,
        mimeType: mimeFromPath(filePath),
      });
    }
    return videos;
  }

  getVideoByID(id: number): PlayableVideo | null {
    const rec = this.repo.findById(id);
    if (!rec) return null;
    if (rec.status !== "success") return null;
    const filePath = this.resolveFilePath(rec);
    if (!filePath) return null;
    if (!isVideoExt(filePath)) return null;
    return {
      id: rec.id,
      title: rec.name,
      url: `/videos/${rec.id}`,
      mimeType: mimeFromPath(filePath),
    };
  }

  getVideoFilePath(id: number): string | null {
    const rec = this.repo.findById(id);
    if (!rec) return null;
    if (rec.status !== "success") return null;
    const filePath = this.resolveFilePath(rec);
    if (!filePath || !isVideoExt(filePath)) return null;
    return filePath;
  }

  /** 附件下载目标（/files/:id）：success 任务解析出的任意落盘文件。
   *  目录（多文件种子）不作为单文件下载目标返回 null。 */
  getFileForDownload(
    id: number,
  ): { filePath: string; fileName: string } | null {
    const rec = this.repo.findById(id);
    if (!rec) return null;
    if (rec.status !== "success") return null;
    const filePath = this.resolveFilePath(rec);
    if (!filePath) return null;
    try {
      if (fs.statSync(filePath).isDirectory()) return null;
    } catch {
      return null;
    }
    return { filePath, fileName: path.basename(filePath) };
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

// 常见非视频附件 MIME（未命中回退 application/octet-stream，attachment 语义下
// 浏览器按扩展保存，MIME 只影响保存对话框预览）
const FILE_MIME: Record<string, string> = {
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ape": "audio/ape",
  ".iso": "application/x-iso9660-image",
  ...Object.fromEntries(Object.entries(MIME).map(([k, v]) => [k, v])),
};

/**
 * 附件下载（/files/:id → Content-Disposition attachment 整文件流）。
 * 与 serveVideoFile 的差异：无 Range（浏览器下载器不需要），文件名进
 * Content-Disposition（RFC 5987 UTF-8 编码，中文名安全），任意扩展。
 */
export function serveFileAttachment(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  downloadName: string,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "file not found" }));
    return;
  }
  const contentType =
    FILE_MIME[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
  const safeName = downloadName.replace(/[\r\n"]/g, "");
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    "X-Content-Type-Options": "nosniff",
    "X-Accel-Buffering": "no",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

/**
 * HTTP Range 流式播放（等价 gin c.File / http.ServeContent 的单段 Range 支持）。
 * 支持 GET（含 Range: bytes=start-end）；HEAD 返回头不带 body。
 */
export function serveVideoFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "video file not found" }));
    return;
  }

  const contentType = mimeFromPath(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && !(m[1] === "" && m[2] === "")) {
      // 'bytes=-' 两端皆空为非法 Range（RFC 9110），忽略按完整文件处理
      let start = m[1] === "" ? 0 : parseInt(m[1]!, 10);
      let end = m[2] === "" ? total - 1 : parseInt(m[2]!, 10);
      if (m[1] === "" && m[2] !== "") {
        // suffix range: bytes=-N → 最后 N 字节
        start = Math.max(0, total - parseInt(m[2]!, 10));
        end = total - 1;
      }
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start > end ||
        start >= total
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      if (end >= total) end = total - 1;
      const headers = {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
      };
      res.writeHead(206, headers);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }
    // Range 头不合法 → 忽略，按完整文件处理
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
