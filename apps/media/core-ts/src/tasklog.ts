// tasklog —— Go internal/tasklog 的复刻：每任务 <id>.log 追加写

import fs from 'node:fs';
import path from 'node:path';

/** 每任务日志管理器（写入串行化，等价 Go 的 mutex） */
export class TaskLogManager {
  private readonly baseDir: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** 追加一行（自动换行） */
  append(taskID: string, line: string): Promise<void> {
    return this.serialize(async () => {
      this.ensureDir();
      fs.appendFileSync(this.logPath(taskID), line + '\n', 'utf8');
    });
  }

  /** 删除已存在的日志文件（任务重启时重置） */
  reset(taskID: string): Promise<void> {
    return this.serialize(() => {
      this.ensureDir();
      try {
        fs.rmSync(this.logPath(taskID), { force: true });
      } catch {
        // 文件不存在 —— 忽略（与 Go os.ErrNotExist 分支一致）
      }
    });
  }

  /** 读取全部日志内容；文件不存在时抛错（调用方按 404 处理） */
  async read(taskID: string): Promise<string> {
    return this.serialize(() => fs.readFileSync(this.logPath(taskID), 'utf8'));
  }

  private logPath(taskID: string): string {
    return path.join(this.baseDir, `${taskID}.log`);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private serialize<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
