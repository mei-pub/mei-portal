// server.ts —— Go cmd/server/main.go 的复刻：CLI 参数解析 + 组件装配 + HTTP 启动
//
// 运行：node --experimental-strip-types src/server.ts \
//   --port=3000 --static-dir=... --db-path=... --config-dir=... \
//   --log-dir=... --local-dir=... --deps-dir=...

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initLogger, logger } from './logger.ts';
import { Conf } from './conf.ts';
import { TaskLogManager } from './tasklog.ts';
import { loadSchemasFromJSON } from './core/schema.ts';
import { BinaryNames, FFmpegBinaryName } from './core/types.ts';
import { DownloaderSvc, type DownloaderConfig } from './core/downloader.ts';
import { TaskQueue } from './core/queue.ts';
import { openDatabase, VideoRepository, FavoriteRepository, ConversionRepository } from './db.ts';
import { DownloadTaskService } from './service/download.ts';
import { FavoriteService } from './service/favorite.ts';
import { Converter } from './service/converter.ts';
import { ConversionService } from './service/conversion.ts';
import { Hub } from './api/sse.ts';
import { VideoService } from './api/video.ts';
import { Handlers, type EnvPaths } from './api/handlers.ts';
import { createServer } from './api/router.ts';

// ---- AppConfig（对应 Go main.AppConfig；默认值改用 /data/media/* 新命名）----

interface AppConfig {
  host: string;
  port: string;
  logLevel: string;
  logDir: string;
  schemaPath: string;
  depsDir: string;
  maxRunner: number;
  localDir: string;
  deleteSegments: boolean;
  proxy: string;
  useProxy: boolean;
  dbPath: string;
  configDir: string;
  staticDir: string;
}

const DEFAULT_LOCAL_DIR = '/data/media/downloads';

function defaultConfig(): AppConfig {
  return {
    host: '0.0.0.0',
    port: '8080',
    logLevel: 'info',
    logDir: '/data/media/logs',
    schemaPath: '',
    depsDir: '',
    maxRunner: 2,
    localDir: DEFAULT_LOCAL_DIR,
    deleteSegments: true,
    proxy: '',
    useProxy: false,
    dbPath: '/data/media/mediago.db',
    configDir: '', // 为空时回落到 logDir（与 Go 一致）
    staticDir: '',
  };
}

/** CLI 参数解析：支持 --key=value 与 --key value 两种形式 */
function parseArgs(argv: string[]): { [key: string]: string | boolean } {
  const out: { [key: string]: string | boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    if (!arg.startsWith('-')) continue;
    arg = arg.replace(/^-+/, '');
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      out[arg.slice(0, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) {
      out[arg] = argv[++i]!;
    } else {
      out[arg] = true;
    }
  }
  return out;
}

function initConfig(): AppConfig {
  const cfg = defaultConfig();
  const args = parseArgs(process.argv.slice(2));

  const str = (key: string, cur: string): string => (typeof args[key] === 'string' && args[key] !== '' ? (args[key] as string) : cur);
  const bool = (key: string, cur: boolean): boolean => (key in args ? args[key] === true || args[key] === 'true' : cur);
  const int = (key: string, cur: number): number => {
    if (key in args) {
      const n = Number.parseInt(String(args[key]), 10);
      if (!Number.isNaN(n)) return n;
    }
    return cur;
  };

  cfg.logLevel = str('log-level', cfg.logLevel);
  cfg.logDir = str('log-dir', cfg.logDir);
  cfg.depsDir = str('deps-dir', cfg.depsDir);
  cfg.schemaPath = str('schema-path', cfg.schemaPath);
  cfg.port = str('port', cfg.port);
  cfg.localDir = str('local-dir', cfg.localDir);
  cfg.deleteSegments = bool('delete-segments', cfg.deleteSegments);
  cfg.proxy = str('proxy', cfg.proxy);
  cfg.useProxy = bool('use-proxy', cfg.useProxy);
  cfg.maxRunner = int('max-runner', cfg.maxRunner);
  cfg.dbPath = str('db-path', cfg.dbPath);
  cfg.configDir = str('config-dir', cfg.configDir);
  cfg.staticDir = str('static-dir', cfg.staticDir);

  // 环境变量覆盖（与 Go 一致：HOST/PORT/DB_PATH）
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.PORT) cfg.port = process.env.PORT;
  if (process.env.DB_PATH) cfg.dbPath = process.env.DB_PATH;

  // schema 路径默认值：等价 Go 的 execDir/config.json → configs/config.json 回落链
  if (cfg.schemaPath === '') {
    const cwdConfig = path.join(process.cwd(), 'configs', 'config.json');
    if (fs.existsSync(cwdConfig)) cfg.schemaPath = cwdConfig;
  }
  if (cfg.configDir === '') cfg.configDir = cfg.logDir;
  return cfg;
}

// ---- AppStore（对应 Go cmd/server/appstore.go 的 AppStore 字段与默认值）----

const appStoreDefaults: Record<string, unknown> = {
  local: '',
  promptTone: true,
  proxy: '',
  useProxy: false,
  deleteSegments: true,
  openInNewWindow: false,
  blockAds: true,
  theme: 'system',
  useExtension: false,
  isMobile: false,
  maxRunner: 2,
  language: 'system',
  showTerminal: false,
  privacy: false,
  machineId: '',
  downloadProxySwitch: false,
  autoUpgrade: true,
  allowBeta: false,
  closeMainWindow: false,
  audioMuted: true,
  enableDocker: false,
  dockerUrl: '',
  enableMobilePlayer: false,
  apiKey: '',
  passwordHash: '',
};

/** 系统下载目录（$HOME/Downloads，缺失回落 $HOME） */
function getSystemDownloadsDir(): string {
  const home = process.env.HOME || process.cwd();
  try {
    if (fs.statSync(path.join(home, 'Downloads')).isDirectory()) return path.join(home, 'Downloads');
  } catch {
    // 不存在 → 回落
  }
  return home;
}

function exeExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

function getBinaryMap(cfg: AppConfig): Record<string, string> {
  const ext = exeExt();
  const m: Record<string, string> = {};
  for (const [dt, name] of Object.entries(BinaryNames)) {
    m[dt] = cfg.depsDir !== '' ? path.join(cfg.depsDir, name + ext) : name + ext;
  }
  return m;
}

function getFFmpegBin(cfg: AppConfig): string {
  if (cfg.depsDir === '') return FFmpegBinaryName + exeExt();
  return path.join(cfg.depsDir, FFmpegBinaryName + exeExt());
}

async function main(): Promise<void> {
  const cfg = initConfig();
  initLogger(cfg.logLevel, cfg.logDir);

  logger.info('MediaGo Downloader Service (TS) Starting...');
  logger.info(`Final Config: ${JSON.stringify(cfg)}`);

  // 1. AppStore（用户级持久配置，config-dir/config.json）
  const appStore = new Conf({
    configName: 'config',
    cwd: cfg.configDir,
    defaults: appStoreDefaults,
  });
  logger.info(`App store initialized at: ${appStore.path()}`);

  // machineId 首次运行生成
  if (!appStore.get('machineId')) {
    const newId = randomUUID();
    await appStore.set('machineId', newId);
    logger.info(`Generated new machineId: ${newId}`);
  }

  // 2. AppStore 值同步回 cfg（CLI 显式 --local-dir 时回写 appStore，否则 appStore 优先）
  const s = appStore.store() as Record<string, unknown>;
  const cliExplicit = cfg.localDir !== '' && cfg.localDir !== DEFAULT_LOCAL_DIR;
  if (cliExplicit) {
    await appStore.set('local', cfg.localDir);
  } else if (typeof s.local === 'string' && s.local !== '') {
    cfg.localDir = s.local;
  }
  if (typeof s.proxy === 'string') cfg.proxy = s.proxy;
  if (typeof s.useProxy === 'boolean') cfg.useProxy = s.useProxy;
  if (typeof s.deleteSegments === 'boolean') cfg.deleteSegments = s.deleteSegments;
  if (typeof s.maxRunner === 'number' && s.maxRunner > 0) cfg.maxRunner = s.maxRunner;

  // 3. 下载目录不可用时回落系统下载目录；appStore 缺 local 时补写
  {
    let needDefault = cfg.localDir === '' || cfg.localDir === './downloads';
    if (!needDefault) {
      try {
        needDefault = !fs.statSync(cfg.localDir).isDirectory();
      } catch {
        needDefault = true;
      }
    }
    if (needDefault) {
      const sysDownloads = getSystemDownloadsDir();
      logger.info(`Download dir "${cfg.localDir}" unavailable, using system default: ${sysDownloads}`);
      cfg.localDir = sysDownloads;
    }
    if (!appStore.get('local')) {
      await appStore.set('local', cfg.localDir);
    }
  }

  // 4. 下载 Schema
  const schemas = loadSchemasFromJSON(cfg.schemaPath);
  logger.info(`Loaded ${schemas.schemas.length} download schemas`);

  // 5. 下载器二进制路径
  const binMap = getBinaryMap(cfg);
  for (const [dt, binPath] of Object.entries(binMap)) {
    logger.info(`${dt} downloader: ${binPath}`);
    if (binPath === '') continue;
    try {
      fs.accessSync(binPath, fs.constants.X_OK);
    } catch {
      logger.warn(`${dt} binary not found or not executable: ${binPath}`);
    }
  }

  // 6. 核心组件
  const downloaderCfg: DownloaderConfig & { [k: string]: unknown } = {
    // 以下 getter 由闭包读最新值（配置热更新后立即生效）
    getLocalDir: () => cfg.localDir,
    getDeleteSegments: () => cfg.deleteSegments,
    getProxy: () => cfg.proxy,
    getUseProxy: () => cfg.useProxy,
  };
  const downloader = new DownloaderSvc(binMap, schemas, downloaderCfg);
  const queue = new TaskQueue(downloader, cfg.maxRunner);
  const taskLogs = new TaskLogManager(path.join(cfg.logDir, 'tasks'));
  logger.info(`Task queue initialized (maxRunner=${cfg.maxRunner})`);
  logger.info(`Task logs will be stored in ${path.join(cfg.logDir, 'tasks')}`);

  // 7. AppStore 变更 → 同步到运行时
  appStore.onDidChange('maxRunner', (newVal) => {
    if (typeof newVal === 'number' && newVal > 0) {
      queue.setMaxRunner(newVal);
      logger.info(`maxRunner updated to ${newVal} via config change`);
    }
  });
  appStore.onDidChange('proxy', (newVal) => {
    if (typeof newVal === 'string') {
      cfg.proxy = newVal;
      logger.info(`proxy updated to "${newVal}" via config change`);
    }
  });
  appStore.onDidChange('useProxy', (newVal) => {
    if (typeof newVal === 'boolean') {
      cfg.useProxy = newVal;
      logger.info(`useProxy updated to ${newVal} via config change`);
    }
  });
  appStore.onDidChange('deleteSegments', (newVal) => {
    if (typeof newVal === 'boolean') {
      cfg.deleteSegments = newVal;
      logger.info(`deleteSegments updated to ${newVal} via config change`);
    }
  });
  appStore.onDidChange('local', (newVal) => {
    if (typeof newVal === 'string' && newVal !== '') {
      cfg.localDir = newVal;
      logger.info(`localDir updated to "${newVal}" via config change`);
    }
  });

  // 8. 数据库
  const dbPath = cfg.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  logger.info(`Database opened: ${dbPath}`);

  const videoRepo = new VideoRepository(db);
  const favoriteRepo = new FavoriteRepository(db);
  const conversionRepo = new ConversionRepository(db);

  const downloadSvc = new DownloadTaskService(videoRepo, queue, taskLogs);
  const favoriteSvc = new FavoriteService(favoriteRepo);
  const converter = new Converter(getFFmpegBin(cfg));

  const hub = new Hub();
  const conversionSvc = new ConversionService(conversionRepo, converter, hub);
  const videoSvc = new VideoService(videoRepo, () => cfg.localDir);

  // 9. 队列回调（tasklog 追加 + DB 状态回写 + SSE 广播；对应 Go queue_callbacks.go）
  queue.onStart = (id) => {
    void taskLogs
      .reset(id)
      .then(() => taskLogs.append(id, 'Task started'))
      .catch((err) => logger.warn(`Failed to reset/append task log id=${id}: ${err?.message ?? err}`));
    const dbID = Number.parseInt(id, 10);
    if (!Number.isNaN(dbID)) {
      try {
        downloadSvc.setStatus([dbID], 'downloading');
      } catch (err: any) {
        logger.warn(`Failed to update DB status on start: ${err?.message ?? err}`);
      }
    }
    hub.broadcast('download-start', { id });
  };
  queue.onSuccess = (id) => {
    void taskLogs.append(id, 'Task completed successfully').catch(() => {});
    const dbID = Number.parseInt(id, 10);
    if (!Number.isNaN(dbID)) {
      try {
        downloadSvc.setStatus([dbID], 'success');
      } catch (err: any) {
        logger.warn(`Failed to update DB status on success: ${err?.message ?? err}`);
      }
    }
    hub.broadcast('download-success', { id });
  };
  queue.onFailed = (id, err) => {
    void taskLogs.append(id, `Task failed: ${err.message}`).catch(() => {});
    const dbID = Number.parseInt(id, 10);
    if (!Number.isNaN(dbID)) {
      try {
        downloadSvc.setStatus([dbID], 'failed');
      } catch (e: any) {
        logger.warn(`Failed to update DB status on failed: ${e?.message ?? e}`);
      }
    }
    hub.broadcast('download-failed', { id, error: err.message });
  };
  queue.onMessage = (m) => {
    logger.info(`[task ${m.id}] ${m.message}`);
    void taskLogs.append(m.id, m.message).catch(() => {});
  };
  queue.onStopped = (id) => {
    void taskLogs.append(id, 'Task stopped').catch(() => {});
    const dbID = Number.parseInt(id, 10);
    if (!Number.isNaN(dbID)) {
      try {
        downloadSvc.setStatus([dbID], 'stopped');
      } catch (err: any) {
        logger.warn(`Failed to update DB status on stopped: ${err?.message ?? err}`);
      }
    }
    hub.broadcast('download-stop', { id });
  };

  // 10. HTTP 服务
  const envPaths: EnvPaths = {
    configDir: cfg.configDir,
    binDir: cfg.depsDir !== '' ? path.dirname(path.resolve(cfg.depsDir)) : process.cwd(),
    platform: process.platform,
    playerUrl: '',
  };

  const handlers = new Handlers(
    queue,
    taskLogs,
    appStore,
    hub,
    downloadSvc,
    favoriteSvc,
    conversionSvc,
    videoSvc,
    envPaths,
  );

  // 播放器 UI 目录（Go 为二进制内嵌；TS 版以目录形式部署，默认取 static-dir 同级的 player/）
  const playerDirFromArgs = parseArgs(process.argv.slice(2))['player-dir'];
  const playerDir =
    typeof playerDirFromArgs === 'string' && playerDirFromArgs !== ''
      ? playerDirFromArgs
      : cfg.staticDir !== ''
        ? path.join(path.dirname(cfg.staticDir), 'player')
        : '';

  const server = createServer({
    handlers,
    videoSvc,
    staticDir: cfg.staticDir,
    playerDir,
    getConfigLang: () => appStore.get('language'),
  });

  const addr = `${cfg.host}:${cfg.port}`;
  server.listen(Number.parseInt(cfg.port, 10), cfg.host, () => {
    logger.info(`Starting HTTP server on ${addr}`);
  });

  // unhandledRejection 兜底：Node 默认会击穿进程；对常驻下载服务，记录后继续运行
  process.on('unhandledRejection', (err) => {
    logger.error(`unhandledRejection: ${err instanceof Error ? err.stack : String(err)}`);
  });

  // 服务退出时回收全部在跑的下载子进程（abort → runner 发 SIGKILL），否则
  // N_m3u8DL-RE/aria2c 等会变成孤儿进程继续下载、占住输出文件
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${sig}, stopping active downloads and shutting down`);
    try {
      queue.stopAll();
    } catch (err: any) {
      logger.warn(`Failed to stop tasks on shutdown: ${err?.message ?? err}`);
    }
    server.close(() => process.exit(0));
    // 兜底：close 回调因残留连接不触发时强制退出
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal(`server failed: ${err?.stack ?? err}`);
});
