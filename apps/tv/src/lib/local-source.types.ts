// 本地源（下载到本地服务器）共享类型 —— 客户端与服务端共用，
// 不引入 node:fs 等服务端依赖（client 组件可安全 import）。

/** 影视分类目录（落盘到 <分类>/<剧名>/ 的第一级目录名） */
export type LocalSourceCategory = '电影' | '电视' | '动漫' | '综艺';

/** 本地源状态：pending/downloading 对应 media 任务未完成；done 表示可用本地流播放 */
export type LocalSourceStatus = 'pending' | 'downloading' | 'done' | 'failed';

export interface LocalSourceRecord {
  /** 记录键：`${normalizeTitle(title)}|${year}|e${episode}`，同一剧同一集幂等 */
  key: string;
  /** 剧名（展示用原文） */
  title: string;
  /** 年份（用于同名剧消歧，可为空串） */
  year: string;
  /** 第几集（1 起；电影单集恒为 1） */
  episode: number;
  /** 总集数（记录时的快照，仅展示用） */
  totalEpisodes: number;
  /** 分类目录名 */
  category: LocalSourceCategory;
  /** media 下载任务名（= 落盘文件名，如 "流浪地球 2" / "庆余年 S01E03"） */
  name: string;
  /** media 下载任务 ID（mediago.db video.id） */
  mediaTaskId: number;
  status: LocalSourceStatus;
  /** done 后可播放的本地流地址（门户根路径 /videos/<id>，nginx 直通 media） */
  localUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/local-sources 响应（按 title 查询时附带瞬时进度） */
export interface LocalSourceWithProgress extends LocalSourceRecord {
  /** 0-100 瞬时进度（来自 media 内存任务队列，非持久化字段） */
  progress: number;
  /** 下载速度快照（如 "2.35MBps"，无则空串） */
  speed: string;
}
