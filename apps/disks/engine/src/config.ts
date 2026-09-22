// 配置 —— 环境变量语义与 Go 版 config/config.go 逐条对齐
// 关键语义：ENABLED_PLUGINS 三态——未设置=不加载任何插件；空串=不加载；列表=只加载列出的

const DEFAULT_CHANNELS = [
  'tgsearchers6',
  'yunpanxunlei',
  'tianyifc',
  'BaiduCloudDisk',
  'txtyzy',
  'beshaozhilu',
  'sharingcloudbaidupan',
  'baiduyunpan',
  'lepanshare',
  'tianyirigeng',
  'tytdyp',
  'pangzilove',
  'QiuShare',
  'yyddhhy',
  'shareAliyun',
  'Quark_Movies',
  'xunleiyunpan',
  'ydypzy',
];

function envStr(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined ? fallback : v;
}

function envInt(name: string, fallback: number, min = 1): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < min) return fallback;
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v !== 'false' && v !== '0';
}

/** ENABLED_PLUGINS 三态解析：undefined=未设置；null=未设置（等价语义）；[] = 空列表 */
function enabledPlugins(): string[] | null {
  const v = process.env['ENABLED_PLUGINS'];
  if (v === undefined) return null; // 未设置 → 不加载任何插件
  if (v === '') return []; // 空串 → 不加载任何插件
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export interface Config {
  port: number;
  host: string;
  proxyURL: string;
  defaultChannels: string[];
  defaultConcurrency: number;
  cacheEnabled: boolean;
  cachePath: string;
  cacheMaxSizeMB: number;
  cacheTTLMinutes: number;
  pluginTimeoutSeconds: number;
  asyncPluginEnabled: boolean;
  enabledPlugins: string[] | null;
  asyncResponseTimeoutSeconds: number;
  asyncCacheTTLHours: number;
  asyncLogEnabled: boolean;
  /** TG 频道批量抓取的硬 deadline：到点返回已收集的部分结果（快窗 4s + 1s 余量） */
  tgDeadlineMs: number;
  /** 单次搜索请求的硬 deadline：到点降级为空成功响应（软窗口全部失守时的安全网） */
  searchHardDeadlineMs: number;
  authEnabled: boolean;
  authUsers: Record<string, string>;
  authTokenExpiryHours: number;
  authJWTSecret: string;
  logPath: string;
}

function authUsers(): Record<string, string> {
  // 格式与 Go 一致：AUTH_USERS="user1:pass1,user2:pass2"
  const users: Record<string, string> = {};
  const v = envStr('AUTH_USERS');
  if (v === '') return users;
  for (const pair of v.split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) users[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return users;
}

export function loadConfig(): Config {
  const channelsEnv = envStr('CHANNELS');
  const defaultChannels =
    channelsEnv === '' ? DEFAULT_CHANNELS : channelsEnv.split(',').map((s) => s.trim()).filter((s) => s !== '');

  // 并发默认值 = 频道数 + 插件数(估 7) + 10（与 Go getDefaultConcurrency 一致）
  const defaultConcurrency = defaultChannels.length + 7 + 10;

  return {
    // PORT 优先，未设置时回退 PANSOU_PORT（start.sh 依赖 PANSOU_PORT；此前写法 fallback 恒真值导致 PANSOU_PORT 永远失效）
    port: envInt('PORT', envInt('PANSOU_PORT', 8888)),
    host: envStr('PANSOU_HOST', '127.0.0.1'),
    proxyURL: envStr('PROXY') || envStr('HTTP_PROXY') || envStr('HTTPS_PROXY'),
    defaultChannels,
    defaultConcurrency: envInt('CONCURRENCY', defaultConcurrency),
    cacheEnabled: envBool('CACHE_ENABLED', true),
    cachePath: envStr('CACHE_PATH', './cache'),
    cacheMaxSizeMB: envInt('CACHE_MAX_SIZE', 100),
    cacheTTLMinutes: envInt('CACHE_TTL', 60),
    pluginTimeoutSeconds: envInt('PLUGIN_TIMEOUT', 30),
    asyncPluginEnabled: envBool('ASYNC_PLUGIN_ENABLED', true),
    enabledPlugins: enabledPlugins(),
    asyncResponseTimeoutSeconds: envInt('ASYNC_RESPONSE_TIMEOUT', 4),
    asyncCacheTTLHours: envInt('ASYNC_CACHE_TTL_HOURS', 1),
    asyncLogEnabled: envBool('ASYNC_LOG_ENABLED', false),
    // 超时分层（由内向外必须递增）：TG 频道单抓 4s abort → TG 整体 deadline →
    // 插件快窗 4s → 请求安全网 searchHardDeadlineMs → shell DisksProvider 8s →
    // 前端 axios 10s → nginx /disks/api 60s。任何一层不得小于内层，否则外层先杀。
    tgDeadlineMs: envInt('TG_DEADLINE_MS', envInt('ASYNC_RESPONSE_TIMEOUT', 4) * 1000 + 1000),
    searchHardDeadlineMs: envInt('SEARCH_HARD_DEADLINE_MS', 7000),
    authEnabled: envBool('AUTH_ENABLED', false),
    authUsers: authUsers(),
    authTokenExpiryHours: envInt('AUTH_TOKEN_EXPIRY_HOURS', 24),
    authJWTSecret: envStr('AUTH_JWT_SECRET', 'mei-pansou-secret'),
    logPath: envStr('LOG_PATH', './logs'),
  };
}

export const config = loadConfig();
