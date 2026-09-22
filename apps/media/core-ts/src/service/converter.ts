// service/converter —— Go internal/service/converter.go 的复刻：exec ffmpeg 转码 + ffprobe 时长 + stderr 进度

import { spawn } from 'node:child_process';
import path from 'node:path';
import { logger } from '../logger.ts';

export type ProgressCallback = (progress: number) => void;

/** ffmpeg 转码管理器：按 id 维护取消句柄 */
export class Converter {
  private readonly cancels = new Map<number, AbortController>();
  private readonly ffmpegBin: string;

  constructor(ffmpegBin: string) {
    this.ffmpegBin = ffmpegBin;
  }

  /**
   * 开始转码，阻塞到完成/取消；onProgress 周期性回调 0-100。
   * 输出路径 = 同目录同名 + 新扩展名（与 Go 一致）。
   */
  async start(
    id: number,
    inputPath: string,
    outputFormat: string,
    quality: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    if (this.ffmpegBin === '') throw new Error('ffmpeg binary path not configured');

    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(dir, `${base}.${outputFormat}`);

    const durationSeconds = await this.probeDuration(inputPath);
    const args = buildFFmpegArgs(inputPath, outputPath, outputFormat, quality);

    const controller = new AbortController();
    this.cancels.set(id, controller);
    try {
      await new Promise<void>((resolve, reject) => {
        const cmd = spawn(this.ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let canceled = false;
        const onAbort = () => {
          canceled = true;
          cmd.kill('SIGKILL');
        };
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });

        // ffmpeg 进度在 stderr，按 \r 或 \n 切分
        const timeRegex = /time=(\d+):(\d+):(\d+)\.(\d+)/;
        let buf = '';
        const handle = (text: string) => {
          const m = timeRegex.exec(text);
          if (m && durationSeconds > 0 && onProgress) {
            const h = parseInt(m[1]!, 10);
            const min = parseInt(m[2]!, 10);
            const s = parseInt(m[3]!, 10);
            const elapsed = h * 3600 + min * 60 + s;
            let pct = Math.floor((elapsed / durationSeconds) * 100);
            if (pct > 100) pct = 100;
            onProgress(pct);
          }
        };
        cmd.stderr.on('data', (chunk: Buffer) => {
          if (!durationSeconds || !onProgress) return;
          buf += chunk.toString('utf8');
          let idx: number;
          // ffmpeg 用 \r 覆写进度行，需同时按 \r 与 \n 切分
          while ((idx = firstEOL(buf)) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            handle(line);
          }
        });

        cmd.on('error', reject);
        cmd.on('close', (code) => {
          controller.signal.removeEventListener('abort', onAbort);
          if (canceled) {
            reject(new Error('conversion cancelled'));
            return;
          }
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg failed: exit status ${code}`));
        });
      });
      return outputPath;
    } finally {
      this.cancels.delete(id);
    }
  }

  /** 取消运行中的转码 */
  stop(id: number): void {
    this.cancels.get(id)?.abort();
  }

  /** ffprobe 取输入时长（秒）；失败返回 0 */
  private async probeDuration(inputPath: string): Promise<number> {
    let ffprobe = this.ffmpegBin.replace(/\.[^./\\]*$/, '');
    if (!ffprobe.endsWith('ffprobe')) {
      ffprobe = path.join(path.dirname(this.ffmpegBin), 'ffprobe');
    }
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const cmd = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        cmd.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
        cmd.on('error', reject);
        cmd.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`exit status ${code}`))));
      });
      const seconds = Number.parseFloat(out.trim());
      if (Number.isNaN(seconds)) return 0;
      return seconds;
    } catch (err: any) {
      logger.warn(`ffprobe failed for ${inputPath}: ${err?.message ?? err}`);
      return 0;
    }
  }
}

function firstEOL(buf: string): number {
  const r = buf.indexOf('\r');
  const n = buf.indexOf('\n');
  if (r < 0) return n;
  if (n < 0) return r;
  return Math.min(r, n);
}

/** 构建 ffmpeg 参数（与 Go buildFFmpegArgs 逐条对齐：x264 crf 18/23/28、vp9、mp3/aac/flac/wav） */
export function buildFFmpegArgs(input: string, output: string, format: string, quality: string): string[] {
  const args = ['-y', '-i', input];
  switch (format) {
    case 'mp4':
    case 'mkv':
      args.push('-c:v', 'libx264', '-crf', String(qualityCRF(quality)), '-c:a', 'aac', '-b:a', '192k');
      break;
    case 'webm':
      args.push('-c:v', 'libvpx-vp9', '-crf', String(qualityCRF(quality)), '-b:v', '0', '-c:a', 'libopus');
      break;
    case 'mp3':
      args.push('-vn', '-acodec', 'libmp3lame', '-b:a', audioQualityMP3(quality));
      break;
    case 'aac':
      args.push('-vn', '-acodec', 'aac', '-b:a', audioQualityAAC(quality));
      break;
    case 'flac':
      args.push('-vn', '-acodec', 'flac');
      break;
    case 'wav':
      args.push('-vn', '-acodec', 'pcm_s16le');
      break;
    default:
      // 未知格式：直拷流
      args.push('-c', 'copy');
      break;
  }
  args.push(output);
  return args;
}

function qualityCRF(quality: string): number {
  switch (quality) {
    case 'high':
      return 18;
    case 'low':
      return 28;
    default:
      return 23;
  }
}

function audioQualityMP3(quality: string): string {
  switch (quality) {
    case 'high':
      return '320k';
    case 'low':
      return '128k';
    default:
      return '192k';
  }
}

function audioQualityAAC(quality: string): string {
  switch (quality) {
    case 'high':
      return '256k';
    case 'low':
      return '96k';
    default:
      return '128k';
  }
}
