// core/runner —— Go internal/core/runner/exec.go 的复刻：spawn 外部二进制，stdout/stderr 并发逐行读
// （PTY 模式弃用，见任务说明；Go 生产环境也曾可用 exec 模式）

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** 对应 Go 的 context.Canceled —— 任务被取消时的哨兵错误 */
export class CanceledError extends Error {
  constructor() {
    super('context canceled');
    this.name = 'CanceledError';
  }
}

/** 单行字节上限（Go bufio.Scanner 默认 64KB；这里放宽到 1MB，超出部分丢弃，防止无换行输出 OOM） */
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * 逐行读流：按 \n 切分（等价 Go bufio.Scanner ScanLines，行尾 \r 剥离）；流被 destroy 时立即收尾。
 * 以字节级缓存整行后再解码，避免多字节字符跨 chunk 被拆散。超长行（无换行的连续输出）
 * 只保留前 MAX_LINE_BYTES 字节，其余丢弃直到下一个换行，杜绝内存无限增长。
 */
function readLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let chunks: Buffer[] = [];
    let pending = 0; // 当前行已缓存字节数
    let overflow = false; // 当前行已超限，丢弃后续直到换行
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const emit = (buf: Buffer) => {
      let s = decodeLine(buf);
      if (s.endsWith('\r')) s = s.slice(0, -1);
      if (s.length > 0) onLine(s);
    };
    stream.on('data', (chunk: Buffer) => {
      if (done) return;
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          if (!overflow && pending + (i - start) <= MAX_LINE_BYTES) {
            chunks.push(chunk.subarray(start, i));
            emit(Buffer.concat(chunks));
          }
          chunks = [];
          pending = 0;
          overflow = false;
          start = i + 1;
        }
      }
      if (start < chunk.length) {
        if (!overflow && pending + (chunk.length - start) > MAX_LINE_BYTES) {
          overflow = true;
          chunks = [];
          pending = 0;
        }
        if (!overflow) {
          chunks.push(chunk.subarray(start));
          pending += chunk.length - start;
        }
      }
    });
    stream.on('end', () => {
      if (chunks.length > 0 && !overflow) emit(Buffer.concat(chunks));
      finish();
    });
    stream.on('error', finish);
    stream.on('close', finish); // destroy()（取消）后只有 close 会触发
  });
}

/** 字节解码：优先 UTF-8，失败回退 GB18030（覆盖 GBK，对齐 Go decodeToUTF8） */
function decodeLine(buf: Buffer): string {
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  }
}

/**
 * 执行命令并逐行读取 stdout + stderr（并发），返回 Promise。
 * - signal abort 时向进程发送 SIGKILL，随后抛出 CanceledError（对应 Go ctx 取消 → Wait 返回 context.Canceled）
 * - 进程非 0 退出抛出 `exit status N`（与 Go err.Error() 文本一致）
 */
export function execRun(
  binPath: string,
  args: string[],
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    } catch (err) {
      reject(err);
      return;
    }

    let canceled = false;
    const onAbort = () => {
      canceled = true;
      child.kill('SIGKILL');
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (canceled) reject(new CanceledError());
      else if (err) reject(err);
      else resolve();
    };

    const stdoutDone = readLines(child.stdout, onLine);
    const stderrDone = readLines(child.stderr, onLine);

    // 结算需同时满足：stdio 流读完 + 进程已退出（以进程退出为准，对应 Go cmd.Wait；
    // 流强收防孤儿子进程握住管道导致取消挂起）
    let streamsDone = false;
    let exitInfo: { code: number | null; err?: Error } | null = null;
    const settle = () => {
      if (settled || !streamsDone || !exitInfo) return;
      if (canceled) {
        finish();
        return;
      }
      if (exitInfo.err) {
        finish(exitInfo.err);
        return;
      }
      if (exitInfo.code === 0) finish();
      else finish(new Error(`exit status ${exitInfo.code}`));
    };

    child.on('error', (err) => {
      // 只记录首个退出信号：spawn 失败时 'error' 与 'exit' 可能都触发，
      // 后到的 exit（code=null，无 err）不能覆盖真正的 spawn 错误
      if (exitInfo) return;
      exitInfo = { code: null, err: err as Error };
      child.stdout?.destroy();
      child.stderr?.destroy();
      settle();
    });

    child.on('exit', (code) => {
      if (exitInfo) return;
      exitInfo = { code };
      // 给管道中残余数据一点排空时间，再强制关闭
      setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, 100);
      settle();
    });

    Promise.all([stdoutDone, stderrDone]).then(() => {
      streamsDone = true;
      settle();
    });
  });
}
