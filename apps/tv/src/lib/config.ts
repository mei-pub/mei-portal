/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import fs from 'node:fs/promises';
import path from 'node:path';

import { db } from '@/lib/db';

import { AdminConfig } from './admin.types';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface LiveCfg {
  name: string;
  url: string;
  ua?: string;
  epg?: string; // 节目单
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site?: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: {
    [key: string]: LiveCfg;
  }
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let cachedConfig: AdminConfig;

const MEI_STORAGE_TYPE = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

// mei-portal：内置热门影视源（苹果CMS 采集 API 格式，api + ?ac=videolist 即可点播）
// 2026-08 实测可用性筛选：索尼/天涯（拒绝搜索）、卧龙（WAF）、无尽（CF 盾）已剔除，
// 换入百度云/新浪/豪华/金鹰。detail 一律留空——非空会走脆弱的 HTML 详情页正则解析，
// JSON 详情（?ac=videolist&ids=）才是稳定路径。
export const MEI_DEFAULT_CONFIG_FILE = JSON.stringify({
  cache_time: 7200,
  api_site: {
    heimuer: { name: '黑木耳', api: 'https://www.heimuer.cc/api.php/provide/vod' },
    liangzi: { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod' },
    baofeng: { name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
    jinying: { name: '金鹰资源', api: 'https://jyzyapi.com/api.php/provide/vod' },
    baiduyun: { name: '百度云资源', api: 'https://api.apibdzy.com/api.php/provide/vod' },
    xinlang: { name: '新浪资源', api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod' },
    haohua: { name: '豪华资源', api: 'https://hhzyapi.com/api.php/provide/vod' },
    guangsu: { name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod' },
    jisu: { name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod' },
    hongniu: { name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod' },
    ffzy: { name: '非凡资源', api: 'http://api.ffzyapi.com/api.php/provide/vod' },
    ruyi: { name: '如意资源', api: 'https://cj.rycjapi.com/api.php/provide/vod' },
    modu: { name: '魔都资源', api: 'https://www.mdzyapi.com/api.php/provide/vod' },
    ikun: { name: '爱坤资源', api: 'https://ikunzyapi.com/api.php/provide/vod' },
  },
});

// 内置源目录同步：新默认源自动补入（保留用户停用状态），
// 已从默认集剔除的旧内置源（from=config 且不在新清单）自动移除；自定义源不动
function mergeDefaultSources(config: AdminConfig): AdminConfig {
  try {
    const defaults = (JSON.parse(MEI_DEFAULT_CONFIG_FILE) as ConfigFileStruct).api_site || {};
    const existing = new Map((config.SourceConfig || []).map((s) => [s.key, s]));
    const merged: AdminConfig['SourceConfig'] = [];
    for (const [key, site] of Object.entries(defaults)) {
      const old = existing.get(key);
      merged.push({
        key,
        name: site.name,
        api: site.api,
        detail: undefined,
        from: 'config',
        disabled: old?.disabled === true,
      });
      existing.delete(key);
    }
    for (const s of Array.from(existing.values())) {
      if (s.from !== 'config') merged.push(s);
    }
    config.SourceConfig = merged;
  } catch (e) {
    console.error('同步内置源目录失败:', e);
  }
  return config;
}

// ---- localstorage 模式的文件持久化（服务端无 db，管理配置落盘到 DATA_DIR）----
const LOCAL_ADMIN_FILE = path.join(
  process.env.DATA_DIR || '/data',
  'tv',
  'admin-config.json'
);

async function loadLocalAdminConfig(): Promise<AdminConfig | null> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_ADMIN_FILE, 'utf8')) as AdminConfig;
  } catch {
    return null;
  }
}

async function saveLocalAdminConfig(config: AdminConfig): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_ADMIN_FILE), { recursive: true });
  await fs.writeFile(LOCAL_ADMIN_FILE, JSON.stringify(config, null, 2));
}

/** 持久化管理配置：localstorage 模式写文件，其余写 db；同时刷新内存缓存 */
export async function persistAdminConfig(config: AdminConfig): Promise<void> {
  cachedConfig = config;
  if (MEI_STORAGE_TYPE === 'localstorage') {
    await saveLocalAdminConfig(config);
    return;
  }
  await db.saveAdminConfig(config);
}

/** 重置为内置热门源（保留站点/用户等其他配置） */
export async function resetSourcesToDefault(): Promise<AdminConfig> {
  const config = await getConfig();
  const fresh = await getInitConfig(MEI_DEFAULT_CONFIG_FILE);
  config.SourceConfig = fresh.SourceConfig;
  await persistAdminConfig(config);
  return config;
}


// 从配置文件补充管理员配置
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch (e) {
    fileConfig = {} as ConfigFileStruct;
  }

  // 合并文件中的源信息
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      // 如果已存在，只覆盖 name、api、detail 和 from
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      // 如果不存在，创建新条目
      currentApiSites.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有源是否在 fileConfig.api_site 中，如果不在则标记为 custom
  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 覆盖 CustomCategories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = currentCustomCategories.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在则标记为 custom
  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type)
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l])
  );
  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = site.name;
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
    } else {
      // 如果不存在，创建新条目
      currentLives.set(key, {
        key,
        name: site.name,
        url: site.url,
        ua: site.ua,
        epg: site.epg,
        channelNumber: 0,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 检查现有 LiveConfig 是否在 fileConfig.lives 中，如果不在则标记为 custom
  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  // 将 Map 转换回数组
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
}

async function getInitConfig(configFile: string, subConfig: {
  URL: string;
  AutoUpdate: boolean;
  LastCheck: string;
} = {
    URL: "",
    AutoUpdate: false,
    LastCheck: "",
  }): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = JSON.parse(configFile) as ConfigFileStruct;
  } catch (e) {
    cfgFile = {} as ConfigFileStruct;
  }
  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscribtion: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MeiTV',
      Announcement:
        process.env.ANNOUNCEMENT || '',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: cfgFile.cache_time || 7200,
      DoubanProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch:
        process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
      EnableWebLive: false,
    },
    UserConfig: {
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  // 补充用户信息
  let userNames: string[] = [];
  // localstorage 模式：用户数据在浏览器端，服务端无用户列表可查。
  // 注意不能写 `db ? ... : []`——db 是 DbManager 单例恒为真值，
  // 那个守卫是死代码，真正区分模式的是存储类型（db 内部会按 storage null 降级为 []）。
  if (MEI_STORAGE_TYPE === 'localstorage') {
    userNames = [];
  } else {
    try {
      userNames = await db.getAllUsers();
    } catch (e) {
      console.error('获取用户列表失败:', e);
      userNames = [];
    }
  }
  const allUsers = userNames.filter((u) => u !== process.env.USERNAME).map((u) => ({
    username: u,
    role: 'user',
    banned: false,
  }));
  allUsers.unshift({
    username: process.env.USERNAME!,
    role: 'owner',
    banned: false,
  });
  adminConfig.UserConfig.Users = allUsers as any;

  // 从配置文件中补充源信息
  Object.entries(cfgFile.api_site || []).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key: key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充自定义分类信息
  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  // 从配置文件中补充直播源信息
  Object.entries(cfgFile.lives || []).forEach(([key, live]) => {
    if (!adminConfig.LiveConfig) {
      adminConfig.LiveConfig = [];
    }
    adminConfig.LiveConfig.push({
      key,
      name: live.name,
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });

  return adminConfig;
}

export async function getConfig(): Promise<AdminConfig> {
  // 直接使用内存缓存
  if (cachedConfig) {
    return cachedConfig;
  }

  // 读配置：localstorage 模式读本地文件（服务端无 db），其余读 db
  let adminConfig: AdminConfig | null = null;
  if (MEI_STORAGE_TYPE === 'localstorage') {
    adminConfig = await loadLocalAdminConfig();
  } else {
    try {
      adminConfig = await db.getAdminConfig();
    } catch (e) {
      console.error('获取管理员配置失败:', e);
    }
  }

  // 无配置时执行一次初始化（内置热门源兜底，保证开箱可点播）
  if (!adminConfig) {
    adminConfig = await getInitConfig(MEI_DEFAULT_CONFIG_FILE);
  }
  adminConfig = configSelfCheck(adminConfig);
  // localstorage 模式：内置源目录与最新默认清单同步（新源自动补入、旧源自动剔除）
  if (MEI_STORAGE_TYPE === 'localstorage') {
    adminConfig = mergeDefaultSources(adminConfig);
  }
  cachedConfig = adminConfig;
  try {
    await persistAdminConfig(cachedConfig);
  } catch (e) {
    console.error('保存管理员配置失败:', e);
  }
  return cachedConfig;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  // 确保必要的属性存在和初始化
  if (!adminConfig.UserConfig) {
    adminConfig.UserConfig = { Users: [] };
  }
  if (!adminConfig.UserConfig.Users || !Array.isArray(adminConfig.UserConfig.Users)) {
    adminConfig.UserConfig.Users = [];
  }
  if (!adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
    adminConfig.SourceConfig = [];
  }
  if (!adminConfig.CustomCategories || !Array.isArray(adminConfig.CustomCategories)) {
    adminConfig.CustomCategories = [];
  }
  if (!adminConfig.LiveConfig || !Array.isArray(adminConfig.LiveConfig)) {
    adminConfig.LiveConfig = [];
  }

  // 站长变更自检
  const ownerUser = process.env.USERNAME;

  // 去重
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) {
      return false;
    }
    seenUsernames.add(user.username);
    return true;
  });
  // 过滤站长
  const originOwnerCfg = adminConfig.UserConfig.Users.find((u) => u.username === ownerUser);
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => user.username !== ownerUser);
  // 其他用户不得拥有 owner 权限
  adminConfig.UserConfig.Users.forEach((user) => {
    if (user.role === 'owner') {
      user.role = 'user';
    }
  });
  // 重新添加回站长
  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis || undefined,
    tags: originOwnerCfg?.tags || undefined,
  });

  // 采集源去重
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((source) => {
    if (seenSourceKeys.has(source.key)) {
      return false;
    }
    seenSourceKeys.add(source.key);
    return true;
  });

  // 自定义分类去重
  const seenCustomCategoryKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter((category) => {
    if (seenCustomCategoryKeys.has(category.query + category.type)) {
      return false;
    }
    seenCustomCategoryKeys.add(category.query + category.type);
    return true;
  });

  // 直播源去重
  const seenLiveKeys = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.filter((live) => {
    if (seenLiveKeys.has(live.key)) {
      return false;
    }
    seenLiveKeys.add(live.key);
    return true;
  });

  return adminConfig;
}

export async function resetConfig() {
  let originConfig: AdminConfig | null = null;
  if (MEI_STORAGE_TYPE === 'localstorage') {
    originConfig = await loadLocalAdminConfig();
  } else {
    try {
      originConfig = await db.getAdminConfig();
    } catch (e) {
      console.error('获取管理员配置失败:', e);
    }
  }
  if (!originConfig) {
    originConfig = {} as AdminConfig;
  }
  const adminConfig = await getInitConfig(originConfig.ConfigFile || MEI_DEFAULT_CONFIG_FILE, originConfig.ConfigSubscribtion);
  await persistAdminConfig(adminConfig);

  return;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);

  if (!user) {
    return allApiSites;
  }

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig) {
    return allApiSites;
  }

  // 优先根据用户自己的 enabledApis 配置查找
  if (userConfig.enabledApis && userConfig.enabledApis.length > 0) {
    const userApiSitesSet = new Set(userConfig.enabledApis);
    return allApiSites.filter((s) => userApiSitesSet.has(s.key)).map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }

  // 如果没有 enabledApis 配置，则根据 tags 查找
  if (userConfig.tags && userConfig.tags.length > 0 && config.UserConfig.Tags) {
    const enabledApisFromTags = new Set<string>();

    // 遍历用户的所有 tags，收集对应的 enabledApis
    userConfig.tags.forEach(tagName => {
      const tagConfig = config.UserConfig.Tags?.find(t => t.name === tagName);
      if (tagConfig && tagConfig.enabledApis) {
        tagConfig.enabledApis.forEach(apiKey => enabledApisFromTags.add(apiKey));
      }
    });

    if (enabledApisFromTags.size > 0) {
      return allApiSites.filter((s) => enabledApisFromTags.has(s.key)).map((s) => ({
        key: s.key,
        name: s.name,
        api: s.api,
        detail: s.detail,
      }));
    }
  }

  // 如果都没有配置，返回所有可用的 API 站点
  return allApiSites;
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}
