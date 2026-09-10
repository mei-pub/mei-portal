// core/queue —— Go internal/core/queue.go 的复刻：并发上限 + FIFO + AbortController 取消

import { logger } from '../logger.ts';
import { CanceledError } from './runner.ts';
import type { DownloaderSvc } from './downloader.ts';
import type { DownloadParams, MessageEvent, ProgressEvent, TaskInfo, TaskStatus } from './types.ts';

export class TaskNotFoundError extends Error {
  constructor() {
    super('task not found');
    this.name = 'TaskNotFoundError';
  }
}

export const ErrTaskNotFound = new TaskNotFoundError();

/** 内存任务队列：并发控制、调度与事件分发（对应 Go TaskQueue） */
export class TaskQueue {
  private readonly downloader: DownloaderSvc;
  private maxRunner: number;

  private queue: DownloadParams[] = [];
  private active = new Map<string, AbortController>();
  private tasks = new Map<string, TaskInfo>();

  // 事件回调（API 层注册）
  onStart?: (id: string) => void;
  onSuccess?: (id: string) => void;
  onFailed?: (id: string, err: Error) => void;
  onStopped?: (id: string) => void;
  onProgress?: (e: ProgressEvent) => void;
  onMessage?: (m: MessageEvent) => void;

  constructor(downloader: DownloaderSvc, maxRunner: number) {
    this.downloader = downloader;
    this.maxRunner = maxRunner;
  }

  isFull(): boolean {
    return this.active.size >= this.maxRunner;
  }

  getDownloader(): DownloaderSvc {
    return this.downloader;
  }

  /** 更新并发上限并尝试补位（配置热更新） */
  setMaxRunner(n: number): void {
    this.maxRunner = n;
    this.tryRun();
  }

  /** 入队：有空位立即执行，否则 FIFO 排队；进行中/排队中的重复任务直接返回现状态 */
  enqueue(p: DownloadParams): TaskStatus {
    // 同一任务重复 start：若仍在排队或执行中，直接返回当前状态。
    // 否则会双开下载进程，且 active map 中后到的 AbortController 会覆盖先到的，
    // 先启动的那个任务从此无法 stop。
    const existing = this.tasks.get(p.id);
    if (existing && (existing.status === 'pending' || existing.status === 'downloading')) {
      logger.warn(`Task re-enqueued while still active id=${p.id} status=${existing.status}`);
      return existing.status;
    }
    this.tasks.set(p.id, {
      id: p.id,
      type: p.type,
      url: p.url,
      name: p.name,
      status: 'pending',
      percent: 0,
      speed: '',
      isLive: false,
    });

    if (this.active.size < this.maxRunner) {
      this.tasks.get(p.id)!.status = 'downloading';
      const controller = new AbortController();
      this.active.set(p.id, controller);
      logger.info(`Task started immediately id=${p.id}`);
      void this.execute(p, controller);
      return 'downloading';
    }
    this.queue.push(p);
    logger.info(`Task enqueued id=${p.id} queueLength=${this.queue.length}`);
    return 'pending';
  }

  /** 停止指定任务（仅对活动任务有效） */
  stop(id: string): void {
    const controller = this.active.get(id);
    if (!controller) {
      logger.warn(`Attempted to stop non-existent task id=${id}`);
      throw ErrTaskNotFound;
    }
    logger.info(`Stopping task id=${id}`);
    controller.abort();
  }

  /** 停止全部活动任务（服务退出时回收子进程，防孤儿） */
  stopAll(): void {
    for (const [id, controller] of this.active) {
      logger.info(`Stopping task id=${id} (shutdown)`);
      try {
        controller.abort();
      } catch (err: any) {
        logger.warn(`Failed to stop task id=${id} on shutdown: ${err?.message ?? err}`);
      }
    }
  }

  /** 从队首取一个任务补位（FIFO） */
  private tryRun(): void {
    if (this.active.size < this.maxRunner && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.tasks.get(task.id)!.status = 'downloading';
      const controller = new AbortController();
      this.active.set(task.id, controller);
      void this.execute(task, controller);
    }
  }

  private async execute(p: DownloadParams, controller: AbortController): Promise<void> {
    logger.info(`Executing task id=${p.id} type=${p.type}`);
    this.tasks.get(p.id)!.status = 'downloading';
    this.onStart?.(p.id);

    let err: Error | undefined;
    try {
      await this.downloader.download(p, {
        onProgress: (e) => {
          const task = this.tasks.get(p.id);
          if (task) {
            task.percent = e.percent;
            task.speed = e.speed;
            task.isLive = e.isLive;
          }
          this.onProgress?.(e);
        },
        onMessage: (m) => {
          this.onMessage?.(m);
        },
      }, controller.signal);
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }

    this.active.delete(p.id);

    if (!err) {
      logger.info(`Task completed successfully id=${p.id}`);
      const task = this.tasks.get(p.id);
      if (task) {
        task.status = 'success';
        task.percent = 100;
      }
      this.onSuccess?.(p.id);
    } else if (err instanceof CanceledError) {
      logger.info(`Task was stopped id=${p.id}`);
      const task = this.tasks.get(p.id);
      if (task) task.status = 'stopped';
      this.onStopped?.(p.id);
    } else {
      logger.error(`Task failed id=${p.id}: ${err.message}`);
      const task = this.tasks.get(p.id);
      if (task) {
        task.status = 'failed';
        task.error = err.message;
      }
      this.onFailed?.(p.id, err);
    }

    this.tryRun();
  }

  getTask(id: string): TaskInfo | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined; // 返回副本防外部改写
  }

  getAllTasks(): TaskInfo[] {
    return Array.from(this.tasks.values(), (t) => ({ ...t }));
  }
}
