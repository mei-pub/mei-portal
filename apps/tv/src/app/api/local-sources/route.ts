/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  movieDownloadRoot,
  removeEpisodeFiles,
  removeSeriesDir,
  shouldRemoveSeriesDir,
} from '@/lib/local-source-files';
import type { LocalSourceRecord } from '@/lib/local-source.types';
import {
  createMediaDownload,
  downloadNameOf,
  LocalSourceStore,
  mapCategory,
  mediaTaskTypeOf,
  recordKeyOf,
  refreshAndDecorate,
  refreshRecord,
  sanitizePlayRoute,
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
    const out = await refreshAndDecorate(store, records);
    return NextResponse.json({ records: out }, { status: 200 });
  } catch (err) {
    console.error('获取本地源失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/local-sources
 * body: { title, year, episode, totalEpisodes, url, className?, doubanType?, playRoute? }
 *
 * 创建 media 下载任务（folder = <分类>/<剧名>，自动启动）并写入本地源记录。
 * 同集已有在途/完成记录时幂等返回，不重复创建。
 * playRoute 为播放页当前路由（usePathname()+search），done 后管理页据此跳回播放器。
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
    const playRoute = sanitizePlayRoute(body.playRoute);

    // 幂等：同集已有在途/完成记录 → 先刷新状态（防陈旧 downloading 挡住重试），再决定复用/重建
    const existing = await store.get(key);
    if (existing && existing.status !== 'failed') {
      const refreshed = await refreshRecord(store, existing);
      if (refreshed.status !== 'failed') {
        // 旧记录缺 playRoute（补齐跳转入口），其余字段保持
        const merged =
          playRoute && !refreshed.playRoute
            ? await store.upsert({ ...refreshed, playRoute, updatedAt: Date.now() })
            : refreshed;
        return NextResponse.json({ record: merged, duplicated: true }, { status: 200 });
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
      playRoute,
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
 *
 * 删除本地源记录并清理落盘文件：
 * - 该集文件：<root>/<分类>/<剧名>/ 下模糊匹配集号的媒体文件（仅 mp4/mkv 等媒体扩展）
 * - 同剧（同 归一剧名|年份 前缀）已无其他记录时，删掉整个剧目录
 * - 防穿越：所有删除路径经 deletionPlanFor 双重校验（段清洗 + resolve 后必须在
 *   /downloads/movie 之内），伪造 title=../../etc 的记录直接拒绝文件操作
 * 文件清理为尽力而为（文件已被手动清走不影响记录删除）；记录本身总是删除。
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
    const record = await store.get(key);
    if (!record) {
      return NextResponse.json({ removed: false }, { status: 200 });
    }

    // 1. 删除记录（先删：后续“同剧是否还有记录”以删后的全量为准）
    await store.remove(key);

    // 2. 清理该集落盘文件（路径非法/文件缺失不阻断记录删除）
    const root = movieDownloadRoot();
    let filesRemoved: string[] = [];
    try {
      filesRemoved = await removeEpisodeFiles(root, record);
    } catch (err) {
      console.warn(`清理本地源文件被拒绝/失败 key=${key}:`, err);
    }

    // 3. 同剧无其他记录 → 删整个剧目录
    let seriesDirRemoved = false;
    try {
      const remaining = await store.listAll();
      if (shouldRemoveSeriesDir(remaining, record)) {
        await removeSeriesDir(root, record);
        seriesDirRemoved = true;
      }
    } catch (err) {
      console.warn(`清理本地源剧目录失败 key=${key}:`, err);
    }

    return NextResponse.json(
      { removed: true, filesRemoved, seriesDirRemoved },
      { status: 200 }
    );
  } catch (err) {
    console.error('删除本地源失败', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
