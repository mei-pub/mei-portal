// i18n —— Go internal/i18n 的精简复刻（en/zh 双语目录，仅覆盖服务端用到的键）

export type Lang = 'en' | 'zh';

export const MSG = {
  OK: 'common.ok',
  DELETED: 'common.deleted',
  IMPORTED: 'common.imported',
  INVALID_ID: 'common.invalid_id',
  UNAUTHORIZED: 'auth.unauthorized',
  TASK_CREATED: 'task.created',
  TASK_ENQUEUED: 'task.enqueued',
  TASK_NOT_FOUND: 'task.not_found',
  TASK_STOPPED: 'task.stopped',
  TASK_LOG_NOT_CONFIGURED: 'task.log_not_configured',
  TASK_LOG_NOT_FOUND: 'task.log_not_found',
  TASK_LOG_READ_FAILED: 'task.log_read_failed',
  DOWNLOAD_STARTED: 'download.started',
  DOWNLOAD_STOPPED: 'download.stopped',
  STATUS_UPDATED: 'download.status_updated',
  CONFIG_UPDATED: 'config.updated',
  CONFIG_KEY_UPDATED: 'config.key_updated', // fmt arg: %s
  URL_REQUIRED: 'util.url_required',
  URL_ALREADY_EXISTS: 'favorite.url_already_exists',
  EVENT_STREAM_FAILED: 'event.stream_failed',
} as const;

const catalogs: Record<Lang, Record<string, string>> = {
  en: {
    [MSG.OK]: 'OK',
    [MSG.DELETED]: 'Deleted',
    [MSG.IMPORTED]: 'Imported',
    [MSG.INVALID_ID]: 'invalid id',
    [MSG.UNAUTHORIZED]: 'unauthorized',
    [MSG.TASK_CREATED]: 'Task created successfully',
    [MSG.TASK_ENQUEUED]: 'Task enqueued successfully',
    [MSG.TASK_NOT_FOUND]: 'task not found',
    [MSG.TASK_STOPPED]: 'Task stopped',
    [MSG.TASK_LOG_NOT_CONFIGURED]: 'task log storage not configured',
    [MSG.TASK_LOG_NOT_FOUND]: 'task log not found',
    [MSG.TASK_LOG_READ_FAILED]: 'failed to read task log',
    [MSG.DOWNLOAD_STARTED]: 'Download started',
    [MSG.DOWNLOAD_STOPPED]: 'Download stopped',
    [MSG.STATUS_UPDATED]: 'Status updated',
    [MSG.CONFIG_UPDATED]: 'Config updated',
    [MSG.CONFIG_KEY_UPDATED]: "Config key '%s' updated",
    [MSG.URL_REQUIRED]: 'url parameter is required',
    [MSG.URL_ALREADY_EXISTS]: 'URL already exists',
    [MSG.EVENT_STREAM_FAILED]: 'Failed to create event stream',
  },
  zh: {
    [MSG.OK]: '操作成功',
    [MSG.DELETED]: '已删除',
    [MSG.IMPORTED]: '已导入',
    [MSG.INVALID_ID]: '无效 ID',
    [MSG.UNAUTHORIZED]: '未授权',
    [MSG.TASK_CREATED]: '任务创建成功',
    [MSG.TASK_ENQUEUED]: '任务已加入队列',
    [MSG.TASK_NOT_FOUND]: '任务未找到',
    [MSG.TASK_STOPPED]: '任务已停止',
    [MSG.TASK_LOG_NOT_CONFIGURED]: '任务日志存储未配置',
    [MSG.TASK_LOG_NOT_FOUND]: '任务日志未找到',
    [MSG.TASK_LOG_READ_FAILED]: '读取任务日志失败',
    [MSG.DOWNLOAD_STARTED]: '下载已开始',
    [MSG.DOWNLOAD_STOPPED]: '下载已停止',
    [MSG.STATUS_UPDATED]: '状态已更新',
    [MSG.CONFIG_UPDATED]: '配置已更新',
    [MSG.CONFIG_KEY_UPDATED]: "配置键 '%s' 已更新",
    [MSG.URL_REQUIRED]: '缺少 url 参数',
    [MSG.URL_ALREADY_EXISTS]: 'URL 已存在',
    [MSG.EVENT_STREAM_FAILED]: '创建事件流失败',
  },
};

export const DEFAULT_LANG: Lang = 'en';

/** 翻译：带 fmt 参数（%s/%d）时做 sprintf 替换（与 Go fmt.Sprintf 行为对齐） */
export function tLang(lang: string | undefined, key: string, ...args: unknown[]): string {
  const l: Lang = lang === 'zh' ? 'zh' : DEFAULT_LANG;
  let msg = catalogs[l][key] ?? catalogs[DEFAULT_LANG][key] ?? key;
  let i = 0;
  msg = msg.replace(/%[sdv]/g, () => String(args[i++] ?? ''));
  return msg;
}

/** 归一化语言字符串到目录键（"zh-CN"/"zh_CN"/"zh" → zh，其余 → en） */
export function resolveCode(lang: string): Lang {
  return lang.toLowerCase().startsWith('zh') ? 'zh' : DEFAULT_LANG;
}

/**
 * 解析请求语言，优先级与 Go i18n.Middleware 一致：
 *  1. ?lang= 查询参数
 *  2. Accept-Language 头
 *  3. 配置存储的 language（仅精确 "zh" 生效，"system" 等回落 en）
 *  4. 默认 en
 */
export function resolveLang(
  queryLang: string | undefined,
  acceptLanguage: string | undefined,
  configLang: unknown,
): Lang {
  if (queryLang) return resolveCode(queryLang);
  if (acceptLanguage && acceptLanguage.toLowerCase().includes('zh')) return 'zh';
  if (configLang === 'zh') return 'zh';
  return DEFAULT_LANG;
}
