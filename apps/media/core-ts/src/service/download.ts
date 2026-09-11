// service/download —— Go internal/service/download_task.go 的复刻

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFilename, sanitizeFolder } from '../core/downloader.ts';
import { logger } from '../logger.ts';
import type { TaskQueue } from '../core/queue.ts';
import type { DownloadParams } from '../core/types.ts';
import type { TaskLogManager } from '../tasklog.ts';
import type { Video, VideoRepository } from '../db.ts';
import { checkFileExists, getPageTitle, randomName } from './helpers.ts';

export interface AddDownloadTaskInput {
  name: string;
  type: string;
  url: string;
  headers?: string | null;
  folder?: string | null;
}

export interface DownloadTaskWithFile extends Video {
  exists: boolean;
  file?: string;
}

export class DownloadTaskService {
  private readonly repo: VideoRepository;
  private readonly queue: TaskQueue;
  private readonly logs: TaskLogManager | null;

  constructor(repo: VideoRepository, queue: TaskQueue, logs: TaskLogManager | null) {
    this.repo = repo;
    this.queue = queue;
    this.logs = logs;
  }

  /** 创建下载任务：自动标题 + sanitize 后查重重名（重名加随机后缀） */
  async addDownloadTask(input: AddDownloadTaskInput): Promise<Video> {
    return (await this.addDownloadTasks([input]))[0]!;
  }

  async addDownloadTasks(inputs: AddDownloadTaskInput[]): Promise<Video[]> {
    const videos: Array<Omit<Video, 'id' | 'createdDate' | 'updatedDate'>> = [];
    for (const input of inputs) {
      let title = input.name;
      if (title === '' && input.type === 'bilibili') {
        title = await getPageTitle(input.url, '');
      }
      if (title === '') {
        title = `untitled-${randomName()}`;
      }
      // sanitize 在查重之前 —— 保证 DB 名 / 下载器参数 / 事后文件检查三处一致
      title = sanitizeFilename(title);
      const existing = this.repo.findByName(title);
      if (existing) {
        title = `${title}-${randomName()}`;
      }
      videos.push({
        name: title,
        type: input.type,
        url: input.url,
        headers: input.headers ?? null,
        // folder 为用户可控，且会拼进 localDir：清洗掉 ../ 等穿越段
        folder: input.folder ? sanitizeFolder(input.folder) : null,
        isLive: false,
        status: 'ready',
      });
    }
    return this.repo.createMany(videos);
  }

  editDownloadTask(id: number, data: { [key: string]: unknown }): Promise<Video> {
    return Promise.resolve(this.repo.update(id, data));
  }

  /** 分页列表（success 任务附带本地文件存在检查） */
  getDownloadTasks(current: number, pageSize: number, filter: string, localPath: string): { total: number; list: DownloadTaskWithFile[] } {
    const result = this.repo.findWithPagination(current, pageSize, filter);
    const list: DownloadTaskWithFile[] = result.items.map((item) => {
      const withFile: DownloadTaskWithFile = { ...item, exists: false };
      if (item.status === 'success' && localPath !== '') {
        let searchDir = localPath;
        if (item.folder && item.folder !== '') searchDir = path.join(localPath, sanitizeFolder(item.folder));
        const [exists, file] = checkFileExists(item.name, searchDir);
        withFile.exists = exists;
        if (file !== '') withFile.file = file;
      }
      return withFile;
    });
    return { total: result.total, list };
  }

  /** 启动下载：状态置 pending → 入队（入队结果回写状态） */
  async startDownload(taskID: number, _localPath: string, _deleteSegments: boolean): Promise<void> {
    const video = this.repo.findByIdOrFail(taskID);
    this.repo.updateStatus([taskID], 'pending');

    let headers: string[] = [];
    if (video.headers && video.headers !== '') {
      try {
        const parsed = JSON.parse(video.headers);
        if (Array.isArray(parsed)) headers = parsed.map(String);
      } catch {
        headers = [];
      }
    }

    const params: DownloadParams = {
      id: String(taskID),
      type: video.type as DownloadParams['type'],
      url: video.url,
      name: video.name,
      // 旧记录可能带未清洗的 folder —— 入队前再洗一次（buildArgs 亦有防御）
      folder: video.folder ? sanitizeFolder(video.folder) : '',
      headers,
    };

    const status = this.queue.enqueue(params);
    if (status === 'downloading') {
      this.repo.updateStatus([taskID], 'downloading');
    } else if (status === 'pending') {
      // 保持 pending
    } else {
      this.repo.updateStatus([taskID], 'failed');
    }
  }

  stopDownload(id: number): void {
    this.queue.stop(String(id));
  }

  /**
   * 删除下载任务：
   * - 总是先停队列（删记录后不允许下载继续进行/文件再落盘）
   * - deleteFiles=true 时尽力清理落盘产物（成功任务的媒体文件/下载器输出目录，
   *   以及未完成任务的分片临时目录），文件缺失不阻断记录删除
   * - localPath 由调用方（handlers）从运行时配置取，服务层不持有 conf
   */
  deleteDownloadTask(id: number, opts?: { deleteFiles?: boolean; localPath?: string }): void {
    const task = this.repo.findById(id);
    // queue.stop 只对活动任务有效，非活动（已完成/排队中/不存在）抛 ErrTaskNotFound：
    // 删除记录时静默忽略（排队中的任务由 repo.delete 消失，队列补位时按 404 跳过）
    try {
      this.queue.stop(String(id));
    } catch {
      // 非活动任务无需停止
    }
    if (task && opts?.deleteFiles) {
      const localPath = opts.localPath || '';
      if (localPath !== '') {
        try {
          let dir = localPath;
          if (task.folder && task.folder !== '') dir = path.join(localPath, sanitizeFolder(task.folder));
          // 成品文件（name.<ext>）与下载器输出目录（name/）都算落盘产物
          const [, file] = checkFileExists(task.name, dir);
          if (file !== '') fs.rmSync(file, { recursive: true, force: true });
        } catch (err: any) {
          logger.warn(`删除任务 ${id} 落盘文件失败: ${err?.message ?? err}`);
        }
      }
    }
    this.repo.delete(id);
  }

  async getDownloadLog(id: number): Promise<string> {
    if (!this.logs) return '';
    try {
      return await this.logs.read(String(id));
    } catch {
      throw new Error('log not found');
    }
  }

  getTaskFolders(): string[] {
    return this.repo.findDistinctFolders();
  }

  exportDownloadList(): string {
    const tasks = this.repo.findAll('DESC');
    return tasks.map((t) => `${t.url} ${t.name}`).join('\n');
  }

  setStatus(ids: number[], status: string): void {
    this.repo.updateStatus(ids, status);
  }

  setIsLive(id: number, isLive: boolean): Video {
    return this.repo.updateIsLive(id, isLive);
  }

  findActiveTasks(): Video[] {
    return this.repo.findByStatus(['pending', 'downloading']);
  }

  findByIdOrFail(id: number): Video {
    return this.repo.findByIdOrFail(id);
  }
}
