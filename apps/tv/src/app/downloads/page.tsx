'use client';

// 已下载资源管理页（/downloads，门户内 /tv/downloads）：
// - 按剧分组展示本地源记录（done 可播放/删除，downloading 进度轮询，failed 标红）
// - 播放优先跳回 playRoute（play 页自动优先本地源，完整播放器体验）；
//   旧记录无 playRoute 时兜底内嵌 <video> 轻量播放（localUrl 为 media 免鉴权流）
// - 删除走二次确认弹层，成功后刷新列表（服务端同步清理落盘文件与空剧目录）

import {
  AlertTriangle,
  Cat,
  CheckCircle2,
  Clover,
  Download,
  Film,
  HardDriveDownload,
  Loader2,
  Play,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import type { LocalSourceWithProgress } from '@/lib/local-source.types';
import {
  deleteLocalSource,
  fetchAllLocalSources,
} from '@/lib/local-sources.client';

type DownloadRow = LocalSourceWithProgress & { sizeBytes?: number | null };

interface SeriesGroup {
  prefix: string;
  title: string;
  year: string;
  category: string;
  records: DownloadRow[];
  doneCount: number;
  updatedAt: number;
}

const CATEGORY_ICON: Record<string, typeof Film> = {
  电影: Film,
  电视: Tv,
  动漫: Cat,
  综艺: Clover,
};

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function statusLabel(rec: DownloadRow): string {
  switch (rec.status) {
    case 'done':
      return '已完成';
    case 'failed':
      return '下载失败';
    case 'pending':
      return '排队中';
    default:
      return rec.progress ? `下载中 ${Math.round(rec.progress)}%` : '下载中';
  }
}

export default function DownloadsPage() {
  const router = useRouter();
  const [records, setRecords] = useState<DownloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<DownloadRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [videoTarget, setVideoTarget] = useState<DownloadRow | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await fetchAllLocalSources();
      setRecords(rows);
      setError('');
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 有在途任务时轮询（3s），驱动 downloading x% → done
  const hasActive = records.some(
    (r) => r.status === 'pending' || r.status === 'downloading'
  );
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const groups = useMemo<SeriesGroup[]>(() => {
    const map = new Map<string, SeriesGroup>();
    for (const r of records) {
      const prefix = `${r.title}|${r.year}`;
      let g = map.get(prefix);
      if (!g) {
        g = {
          prefix,
          title: r.title,
          year: r.year,
          category: r.category,
          records: [],
          doneCount: 0,
          updatedAt: 0,
        };
        map.set(prefix, g);
      }
      g.records.push(r);
      if (r.status === 'done') g.doneCount += 1;
      if (r.updatedAt > g.updatedAt) g.updatedAt = r.updatedAt;
    }
    const out = Array.from(map.values());
    for (const g of out) g.records.sort((a, b) => a.episode - b.episode);
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [records]);

  const handlePlay = (rec: DownloadRow) => {
    if (rec.status !== 'done') return;
    // 优先：跳回下载发起时的播放页（play 页自动优先本地源，完整播放器体验）
    if (rec.playRoute) {
      router.push(rec.playRoute);
      return;
    }
    // 兜底：旧记录无 playRoute → 内嵌 video 轻量播放（media 免鉴权流）
    setVideoTarget(rec);
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    try {
      await deleteLocalSource(confirmTarget.key);
      setConfirmTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message || '删除失败');
      setConfirmTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageLayout activePath='/downloads'>
      <div className='mx-auto w-full max-w-4xl px-5 py-6 lg:px-8'>
        {/* 页头 */}
        <div className='mb-6 flex items-center gap-3'>
          <span className='flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md'>
            <HardDriveDownload className='h-6 w-6' />
          </span>
          <div>
            <h1 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
              已下载资源
            </h1>
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              在播放页点「下载到服务器」，完成后在这里管理
            </p>
          </div>
        </div>

        {error && (
          <div className='mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'>
            {error}
          </div>
        )}

        {loading ? (
          <div className='flex items-center justify-center py-24 text-gray-400'>
            <Loader2 className='mr-2 h-5 w-5 animate-spin' /> 加载中...
          </div>
        ) : groups.length === 0 ? (
          /* 空状态引导 */
          <div className='flex flex-col items-center justify-center rounded-3xl border border-black/10 bg-white/70 py-20 text-center shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-gray-900/60'>
            <div className='relative mb-6'>
              <div className='absolute inset-0 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 opacity-20 blur-xl' />
              <div className='relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg'>
                <Download className='h-9 w-9' />
              </div>
            </div>
            <h2 className='mb-2 text-lg font-bold text-gray-800 dark:text-gray-200'>
              还没有下载到服务器的资源
            </h2>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              在播放页点「下载到服务器」，完成后在这里管理和播放
            </p>
          </div>
        ) : (
          <div className='space-y-5'>
            {groups.map((g) => {
              const Icon = CATEGORY_ICON[g.category] ?? Film;
              return (
                <div
                  key={g.prefix}
                  className='rounded-2xl border border-black/10 bg-white/75 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/60'
                >
                  {/* 剧头：海报占位 + 剧名 / 年份 / 分类 */}
                  <div className='mb-3 flex items-center gap-3'>
                    <span className='flex h-16 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md'>
                      <Icon className='h-5 w-5' />
                    </span>
                    <div className='min-w-0 flex-1'>
                      <h2 className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
                        {g.title}
                      </h2>
                      <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                        {g.year && <span>{g.year}</span>}
                        <span className='rounded border border-gray-400/40 px-1.5 py-px'>
                          {g.category}
                        </span>
                        <span>
                          {g.doneCount}/{g.records.length} 集可用
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 集条目 */}
                  <ul className='space-y-2'>
                    {g.records.map((rec) => {
                      const single =
                        !rec.totalEpisodes || rec.totalEpisodes <= 1;
                      return (
                        <li
                          key={rec.key}
                          className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-gray-100/60 px-3 py-2.5 dark:bg-gray-800/60'
                        >
                          <span className='min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200'>
                            {single
                              ? rec.name
                              : `第 ${rec.episode} 集${
                                  rec.status === 'failed' ? ' · 下载失败' : ''
                                }`}
                          </span>

                          {/* 状态 / 进度 */}
                          {rec.status === 'downloading' ||
                          rec.status === 'pending' ? (
                            <span className='flex min-w-[140px] flex-1 items-center gap-2'>
                              <span className='h-1.5 flex-1 overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600'>
                                <span
                                  className='block h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-500'
                                  style={{ width: `${Math.min(100, Math.max(0, rec.progress ?? 0))}%` }}
                                />
                              </span>
                              <span className='flex-shrink-0 text-xs text-gray-500 dark:text-gray-400'>
                                {statusLabel(rec)}
                                {rec.status === 'downloading' && rec.speed
                                  ? ` · ${rec.speed}`
                                  : ''}
                              </span>
                            </span>
                          ) : (
                            <span
                              className={`flex items-center gap-1 text-xs font-medium ${
                                rec.status === 'done'
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-500 dark:text-red-400'
                              }`}
                            >
                              {rec.status === 'done' ? (
                                <>
                                  <CheckCircle2 className='h-3.5 w-3.5' />
                                  已完成
                                  {fmtSize(rec.sizeBytes) && (
                                    <span className='ml-1 font-normal text-gray-400'>
                                      {fmtSize(rec.sizeBytes)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                statusLabel(rec)
                              )}
                            </span>
                          )}

                          {/* 操作 */}
                          {rec.status === 'done' && rec.localUrl && (
                            <button
                              onClick={() => handlePlay(rec)}
                              title={
                                rec.playRoute
                                  ? '跳回播放页（本地源优先）'
                                  : '内嵌播放器播放（旧记录，无原始播放路径）'
                              }
                              className='flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 transition-colors hover:bg-green-500/20 dark:text-green-400'
                            >
                              <Play className='h-3.5 w-3.5' /> 播放
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmTarget(rec)}
                            title='删除该集（含落盘文件）'
                            className='flex items-center gap-1 rounded-full border border-gray-300/60 px-3 py-1 text-xs text-gray-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-gray-600/60 dark:text-gray-400 dark:hover:border-red-500 dark:hover:text-red-400'
                          >
                            <Trash2 className='h-3.5 w-3.5' /> 删除
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 删除二次确认弹层（对齐 DataMigration AlertModal 风格） */}
      {confirmTarget && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
          onClick={() => !deleting && setConfirmTarget(null)}
        >
          <div
            className='w-full max-w-md rounded-lg border border-red-200 bg-red-50 shadow-xl transition-all dark:border-red-800 dark:bg-red-900/20'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='p-6 text-center'>
              <div className='mb-4 flex justify-center'>
                <AlertTriangle className='h-12 w-12 text-yellow-500' />
              </div>
              <h3 className='mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100'>
                删除已下载资源？
              </h3>
              <p className='mb-4 text-sm text-gray-600 dark:text-gray-400'>
                将删除「{confirmTarget.title}」
                {confirmTarget.totalEpisodes > 1
                  ? ` 第 ${confirmTarget.episode} 集`
                  : ''}{' '}
                的记录与服务器上的落盘文件，删除后不可恢复。
              </p>
              <div className='flex justify-center space-x-3'>
                <button
                  onClick={() => setConfirmTarget(null)}
                  disabled={deleting}
                  className='rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                >
                  取消
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className='rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50'
                >
                  {deleting ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 兜底轻量播放弹窗（旧记录无 playRoute）：localUrl 为 media 免鉴权流，可直接播 */}
      {videoTarget && videoTarget.localUrl && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
          onClick={() => setVideoTarget(null)}
        >
          <div
            className='w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-gray-900 shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between px-4 py-3'>
              <span className='truncate text-sm font-medium text-gray-100'>
                {videoTarget.name}
              </span>
              <button
                onClick={() => setVideoTarget(null)}
                title='关闭'
                className='rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            <video
              controls
              autoPlay
              src={videoTarget.localUrl}
              className='aspect-video w-full bg-black'
            />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
