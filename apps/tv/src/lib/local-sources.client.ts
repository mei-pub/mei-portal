// 本地源客户端：播放页对 /api/local-sources 的薄封装。
// fetch('/api/...') 由 layout 注入的 window.fetch 改写器自动补 /tv basePath。

import type {
  LocalSourceRecord,
  LocalSourceWithProgress,
} from './local-source.types';

export interface LocalSourceQuery {
  title: string;
  year?: string;
}

/** 查询某剧的全部本地源记录（服务端顺带刷新在途任务状态并带回瞬时进度） */
export async function fetchLocalSources(
  query: LocalSourceQuery
): Promise<LocalSourceWithProgress[]> {
  const params = new URLSearchParams({ title: query.title });
  if (query.year) params.set('year', query.year);
  const res = await fetch(`/api/local-sources?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`查询本地源失败 (${res.status})`);
  }
  const data = (await res.json()) as { records: LocalSourceWithProgress[] };
  return data.records ?? [];
}

/** 查询全部本地源记录（已下载资源管理页；含在途瞬时进度与 done 记录的 sizeBytes） */
export async function fetchAllLocalSources(): Promise<
  Array<LocalSourceWithProgress & { sizeBytes?: number | null }>
> {
  const res = await fetch('/api/local-sources/list', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`查询本地源列表失败 (${res.status})`);
  }
  const data = (await res.json()) as {
    records: Array<LocalSourceWithProgress & { sizeBytes?: number | null }>;
  };
  return data.records ?? [];
}

export interface CreateLocalDownloadInput {
  title: string;
  year?: string;
  episode: number; // 1 起
  totalEpisodes: number;
  url: string; // 当前集的播放直链（当前选中源）
  className?: string; // CMS 分类（detail.vod_class）
  doubanType?: string; // 豆瓣 type（movie/tv/anime/show）
  playRoute?: string; // 播放页当前路由（usePathname()+search），done 后管理页据此跳回播放器
}

/** 发起「下载到本地服务器」：服务端创建 media 任务并记录本地源 */
export async function createLocalDownload(
  input: CreateLocalDownloadInput
): Promise<{ record: LocalSourceRecord; duplicated: boolean }> {
  const res = await fetch('/api/local-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `创建下载失败 (${res.status})`);
  }
  return {
    record: data.record as LocalSourceRecord,
    duplicated: !!data.duplicated,
  };
}

/** 删除单条本地源记录（服务端同时清理落盘文件与空剧目录） */
export async function deleteLocalSource(key: string): Promise<boolean> {
  const res = await fetch(`/api/local-sources?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`删除本地源失败 (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as { removed?: boolean };
  return !!data.removed;
}
