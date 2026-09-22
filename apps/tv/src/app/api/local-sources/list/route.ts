/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { episodeFilesSize, movieDownloadRoot } from '@/lib/local-source-files';
import type { LocalSourceWithProgress } from '@/lib/local-source.types';
import { LocalSourceStore, refreshAndDecorate } from '@/lib/local-sources';

export const runtime = 'nodejs';

// 单例存储（与 /api/local-sources 共享同一数据文件；模块各自常驻互不干扰）
const store = new LocalSourceStore();

/**
 * GET /api/local-sources/list
 *
 * 全量本地源记录（已下载资源管理页）：
 * - 在途记录顺带刷新状态机（复用按剧查询 GET 的刷新逻辑）+ 瞬时进度，
 *   调用方轮询本接口即可驱动 pending → downloading x% → done
 * - done 记录附带 sizeBytes（落盘文件大小，尽力而为，缺失为 null）
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const records = await store.listAll();
    const decorated = await refreshAndDecorate(store, records);

    // done 记录附带文件大小（管理页展示；非契约核心字段，尽力而为）
    const root = movieDownloadRoot();
    const out: Array<
      LocalSourceWithProgress & { sizeBytes: number | null }
    > = await Promise.all(
      decorated.map(async (rec) => {
        if (rec.status !== 'done') return { ...rec, sizeBytes: null };
        try {
          return { ...rec, sizeBytes: await episodeFilesSize(root, rec) };
        } catch {
          return { ...rec, sizeBytes: null };
        }
      })
    );

    return NextResponse.json({ records: out }, { status: 200 });
  } catch (err) {
    console.error('获取本地源列表失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
