import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
// 加载源按优先级排列：unpkg 不可达（内网/被墙/DNS 故障）时自动落到 jsdelivr。
// 注意：本仓库 public 下没有 ffmpeg-core 本地副本，若要完全离线可用，
// 需要在构建期把 @ffmpeg/core 的 dist/esm 产物复制进 public/ffmpeg/ 并在
// 这里把同源地址排在最前（见 loadCoreSources）。
const CDN_BASES = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`
];

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

type FFmpegTaskContext = {
  ffmpeg: FFmpeg;
  tempFile: (extension: string) => string;
};

/**
 * 依次尝试每个加载源，把 core.js / core.wasm 拉成 Blob URL。
 * 全部失败时抛出带明确中文说明的错误，调用方（音频处理工具页）会把它展示给用户。
 */
async function loadCoreFromAnySource(): Promise<{
  coreURL: string;
  wasmURL: string;
}> {
  const failures: string[] = [];

  for (const base of CDN_BASES) {
    try {
      const coreURL = await toBlobURL(
        `${base}/ffmpeg-core.js`,
        'text/javascript'
      );
      const wasmURL = await toBlobURL(
        `${base}/ffmpeg-core.wasm`,
        'application/wasm'
      );
      return { coreURL, wasmURL };
    } catch (error) {
      failures.push(
        `${new URL(base).host}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error(
    `FFmpeg 内核加载失败：无法从任何源（unpkg、jsdelivr）下载 ffmpeg-core。` +
      `请检查网络连接后重试。${failures.join('；')}`
  );
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance;
  }

  if (!loadingPromise) {
    loadingPromise = (async () => {
      const ffmpeg = new FFmpeg();

      const { coreURL, wasmURL } = await loadCoreFromAnySource();
      await ffmpeg.load({ coreURL, wasmURL });

      ffmpegInstance = ffmpeg;

      return ffmpeg;
    })();
  }

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

/**
 * Destroy the current FFmpeg instance.
 *
 * Normally not needed because the instance is reused.
 * Use only after worker crashes or when explicitly freeing memory.
 */
export function resetFFmpeg(): void {
  ffmpegInstance?.terminate();

  ffmpegInstance = null;
  loadingPromise = null;
}

// FFmpeg worker is not safe for concurrent operations.
let taskQueue: Promise<unknown> = Promise.resolve();

export async function runFFmpegTask<T>(
  task: (context: FFmpegTaskContext) => Promise<T>
): Promise<T> {
  const ffmpeg = await getFFmpeg();

  const run = taskQueue
    .catch(() => {})
    .then(async () => {
      const tempFiles = new Set<string>();

      const tempFile = (extension: string) => {
        const filename = `${crypto.randomUUID()}${extension}`;

        tempFiles.add(filename);

        return filename;
      };

      try {
        return await task({
          ffmpeg,
          tempFile
        });
      } finally {
        await Promise.all(
          [...tempFiles].map((file) => ffmpeg.deleteFile(file).catch(() => {}))
        );
      }
    });

  taskQueue = run.catch(() => {});

  return run;
}
