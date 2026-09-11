/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import type { LocalSourceRecord, LocalSourceWithProgress } from '@/lib/local-source.types';
import {
  createMediaDownload,
  downloadNameOf,
  fetchMediaDownload,
  fetchMediaTaskProgress,
  LocalSourceStore,
  mapCategory,
  mapMediaStatus,
  mediaTaskTypeOf,
  recordKeyOf,
} from '@/lib/local-sources';

export const runtime = 'nodejs';

// 单例存储（route handler 模块在 Next 服务进程内常驻）
const store = new LocalSourceStore();

async function requireAuth(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return null;
  }
  return authInfo.username;
}

/**
 * GET /api/local-sources?title=<剧名>&year=<年份>
 *
 * 返回该剧的全部本地源记录（含瞬时的下载进度）。
 * 每次查询顺带刷新在途记录的状态（media 任务 success → done + localUrl；
 * failed/stopped → failed），调用方（播放页）只需轮询本接口即可驱动状态机。
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await requireAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');
    if (!title) {
      return NextResponse.json({ error: '缺少 title 参数' }, { status: 400 });
    }
    const year = searchParams.get('year') ?? '';

    const records = await store.listByTitle(title, year);
    const out: LocalSourceWithProgress[] = [];

    for (const rec of records) {
      let current = rec;
      if (current.status === 'pending' || current.status === 'downloading') {
        current = await refreshRecord(current);
      }
      // 瞬时进度（内存队列；服务重启后查不到 → 0）
      let progress = 0;
      let speed = '';
      if (current.status === 'pending' || current.status === 'downloading') {
        const task = await fetchMediaTaskProgress(current.mediaTaskId);
        if (task) {
          progress = task.percent ?? 0;
          speed = task.speed ?? '';
          if (current.status === 'pending' && task.status === 'downloading') {
            // DB 状态滞后（onStart 回写晚于入队）：以内存队列为准
            current = await store.upsert({
              ...current,
              status: 'downloading',
              updatedAt: Date.now(),
            });
          }
        }
      }
      out.push({ ...current, progress, speed });
    }

    return NextResponse.json({ records: out }, { status: 200 });
  } catch (err) {
    console.error('获取本地源失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/local-sources
 * body: { title, year, episode, totalEpisodes, url, className?, doubanType? }
 *
 * 创建 media 下载任务（folder = <分类>/<剧名>，自动启动）并写入本地源记录。
 * 同集已有在途/完成记录时幂等返回，不重复创建。
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await requireAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const title = String(body.title ?? '').trim();
    const url = String(body.url ?? '').trim();
    const episode = Number(body.episode ?? 0);
    const totalEpisodes = Number(body.totalEpisodes ?? 0);

    if (!title || !url || !Number.isInteger(episode) || episode < 1) {
      return NextResponse.json(
        { error: '缺少必要参数（title/url/episode）' },
        { status: 400 }
      );
    }

    const year = String(body.year ?? '').trim();
    const key = recordKeyOf(title, year, episode);

    // 幂等：同集已有在途/完成记录 → 先刷新状态（防陈旧 downloading 挡住重试），再决定复用/重建
    const existing = await store.get(key);
    if (existing && existing.status !== 'failed') {
      const refreshed = await refreshRecord(existing);
      if (refreshed.status !== 'failed') {
        return NextResponse.json(
          { record: refreshed, duplicated: true },
          { status: 200 }
        );
      }
    }

    const category = mapCategory({
      doubanType: body.doubanType,
      className: body.className,
      totalEpisodes: totalEpisodes || undefined,
    });
    const name = downloadNameOf(title, episode, totalEpisodes);

    // media 任务：文件夹按 <分类>/<剧名> 落盘；name 会再被 media sanitize 一次
    const video = await createMediaDownload({
      name,
      url,
      folder: `${category}/${title}`,
      type: mediaTaskTypeOf(url),
    });

    const now = Date.now();
    const record: LocalSourceRecord = {
      key,
      title,
      year,
      episode,
      totalEpisodes,
      category,
      name: video.name || name,
      mediaTaskId: video.id,
      status: 'downloading',
      localUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.upsert(record);
    return NextResponse.json({ record, duplicated: false }, { status: 200 });
  } catch (err) {
    console.error('创建本地下载失败', err);
    const message = err instanceof Error ? err.message : '创建下载任务失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * DELETE /api/local-sources?key=<记录键>
 * 只删除本地源记录（不影响 media 下载任务与已落盘文件）。
 */
export async function DELETE(request: NextRequest) {
  try {
    if (!(await requireAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const key = new URL(request.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
    }
    const removed = await store.remove(key);
    return NextResponse.json({ removed }, { status: 200 });
  } catch (err) {
    console.error('删除本地源失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** 刷新单条在途记录：media 任务终态回写（done + localUrl / failed） */
async function refreshRecord(rec: LocalSourceRecord): Promise<LocalSourceRecord> {
  const video = await fetchMediaDownload(rec.mediaTaskId);
  if (!video) return rec; // 查不到（如任务被手动删除）：保持原状态
  const mapped = mapMediaStatus(video.status);
  if (!mapped || mapped === rec.status) return rec;

  const updated: LocalSourceRecord = {
    ...rec,
    status: mapped,
    localUrl: mapped === 'done' ? `/videos/${rec.mediaTaskId}` : rec.localUrl,
    updatedAt: Date.now(),
  };
  return store.upsert(updated);
}
