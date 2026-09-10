// 类型定义 —— 与 Go 版 model/ 逐字段对齐（JSON 字段名不变，前端零改动）
// datetime 在 Go 序列化为 RFC3339 字符串，这里统一用 ISO 字符串，等价。

/** 网盘链接 */
export interface Link {
  type: string;
  url: string;
  password: string;
  /** 链接更新时间（可选） */
  datetime?: string;
  /** 作品标题（用于区分同一消息中多个作品的链接） */
  work_title?: string;
}

/** 搜索结果 */
export interface SearchResult {
  message_id: string;
  /** 全局唯一 ID：TG 为 "频道_消息ID"，插件为 "插件名-资源ID" */
  unique_id: string;
  /** TG 频道名；插件结果必须为空 */
  channel: string;
  datetime: string;
  title: string;
  content: string;
  links: Link[];
  tags?: string[];
  /** TG 消息中的图片链接 */
  images?: string[];
}

/** 合并后的网盘链接（按类型分组后的元素） */
export interface MergedLink {
  url: string;
  password: string;
  note: string;
  datetime: string;
  /** 数据来源：tg:频道名 或 plugin:插件名 */
  source?: string;
  images?: string[];
}

/** 按网盘类型分组的合并链接 */
export type MergedLinks = Record<string, MergedLink[]>;

/** 搜索响应 */
export interface SearchResponse {
  total: number;
  results?: SearchResult[];
  merged_by_type?: MergedLinks;
}

/** API 通用响应 */
export interface Response<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export function newSuccessResponse<T>(data: T): Response<T> {
  return { code: 0, message: 'success', data };
}

export function newErrorResponse(code: number, message: string): Response<never> {
  return { code, message };
}

/** 过滤配置 */
export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

/** 搜索请求参数 */
export interface SearchRequest {
  kw: string;
  channels?: string[];
  conc?: number;
  refresh?: boolean;
  /** all(返回所有) | results(仅results) | merge(仅merged_by_type) */
  res?: string;
  /** all | tg | plugin */
  src?: string;
  plugins?: string[] | null;
  ext?: Record<string, unknown>;
  cloud_types?: string[] | null;
  filter?: FilterConfig;
}

/** 链接检查 */
export interface CheckItem {
  disk_type: string;
  url: string;
  password?: string;
}

export interface CheckRequest {
  items: CheckItem[];
  view_token?: string;
  proxy?: string;
  proxy_url?: string;
}

export interface CheckResult {
  disk_type: string;
  url: string;
  normalized_url?: string;
  state: string;
  cache_hit: boolean;
  checked_at: number;
  expires_at: number;
  summary?: string;
}

/** 插件接口 —— Go AsyncSearchPlugin 的 TS 对应物 */
export interface SearchPlugin {
  name: string;
  /** 插件等级（1-4，影响排序得分：1000/500/0/-200） */
  priority: number;
  /** 磁力类等需要宽泛结果的插件返回 true，跳过 Service 层关键词过滤 */
  skipServiceFilter: boolean;
  /** 纯搜索实现：抓取并解析（框架负责超时/缓存/后台补全） */
  search(keyword: string, ext: Record<string, unknown>): Promise<SearchResult[]>;
}
