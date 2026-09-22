// service/conversion —— Go internal/service/conversion.go 的复刻

import type { Hub } from '../api/sse.ts';
import { logger } from '../logger.ts';
import type { Conversion, ConversionRepository } from '../db.ts';
import type { Converter } from './converter.ts';

export interface AddConversionInput {
  name: string | null;
  path: string;
  outputFormat: string;
  quality: string;
}

export class ConversionService {
  private readonly repo: ConversionRepository;
  private readonly converter: Converter;
  private readonly hub: Hub;

  constructor(repo: ConversionRepository, converter: Converter, hub: Hub) {
    this.repo = repo;
    this.converter = converter;
    this.hub = hub;
  }

  getConversions(current: number, pageSize: number): { total: number; list: Conversion[] } {
    const result = this.repo.findWithPagination(current, pageSize);
    return { total: result.total, list: result.items };
  }

  addConversion(input: AddConversionInput): Conversion {
    return this.repo.create({
      name: input.name,
      path: input.path,
      outputFormat: input.outputFormat,
      quality: input.quality,
      status: 'pending',
    });
  }

  deleteConversion(id: number): void {
    this.repo.delete(id);
  }

  findByIdOrFail(id: number): Conversion {
    return this.repo.findByIdOrFail(id);
  }

  /** 启动转码：置 converting 后异步执行，进度/结果经 DB + SSE 广播 */
  startConversion(id: number): void {
    const conv = this.repo.findByIdOrFail(id);
    if (conv.status !== 'pending' && conv.status !== 'failed') {
      throw new Error(`conversion ${id} is not in a startable state (status: ${conv.status})`);
    }
    this.repo.updateStatus(id, 'converting', 0, '', null);
    this.hub.broadcast('conversion-start', { id });

    void (async () => {
      try {
        const outputPath = await this.converter.start(id, conv.path, conv.outputFormat, conv.quality, (progress) => {
          this.repo.updateStatus(id, 'converting', progress, '', null);
          this.hub.broadcast('conversion-progress', { id, progress });
        });
        this.repo.updateStatus(id, 'done', 100, outputPath, null);
        this.hub.broadcast('conversion-success', { id, outputPath });
        logger.info(`Conversion ${id} completed: ${outputPath}`);
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        this.repo.updateStatus(id, 'failed', 0, '', errMsg);
        this.hub.broadcast('conversion-failed', { id, error: errMsg });
        logger.error(`Conversion ${id} failed: ${errMsg}`);
      }
    })();
  }

  stopConversion(id: number): void {
    this.converter.stop(id);
    this.repo.updateStatus(id, 'failed', 0, '', 'cancelled by user');
    this.hub.broadcast('conversion-stop', { id });
  }
}
