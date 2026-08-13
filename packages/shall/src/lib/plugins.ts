// 插件清单聚合 —— 构建期读取 ../../../plugins/*/manifest.yml
// ⚠️ 本模块含 node:fs，仅限服务端组件/API 路由引用。
// 客户端组件请引用 ./categories（纯常量）。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Category } from './categories';

export type { Category, ClientPlugin } from './categories';
import { CATEGORY_LABELS } from './categories';
export { CATEGORY_LABELS };

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  icon: string;
  category: Category;
  weight: number;
  endpoint: string;
  subdomainPrefix?: string; // 由 plugins.json 预计算，运行时优先用
  ingress: {
    mode: 'subdomain' | 'external';
    host: string;
  };
  auth?: { strategy: 'independent' | 'token_inject' | 'sso' };
  embed?: { iframe: boolean; strip_headers?: string[] };
  theme?: { has_skin: boolean; entry?: string };
  health?: { path: string; expect: number };
  upgrade?: { image?: string; repo?: string };
  disguise?: { name: string; icon: string; url: string };
}

// 构建期：扫描仓库根的 plugins/
// 运行时（Docker standalone）：读 public/__theme/plugins.json（由 build-theme.mjs 预生成）
function loadManifests(): PluginManifest[] {
  // 优先读预生成的 plugins.json（Docker 运行时唯一可用途径）
  const jsonPath = path.join(process.cwd(), 'public', '__theme', 'plugins.json');
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Array<{
      id: string;
      name: string;
      description?: string;
      icon: string;
      category: Category;
      weight: number;
      subdomainPrefix: string;
      endpoint: string;
      healthPath?: string;
      healthExpect?: number;
      hasSkin: boolean;
    }>;
    return raw.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      category: p.category,
      weight: p.weight,
      endpoint: p.endpoint,
      ingress: { mode: 'subdomain' as const, host: '' },
      subdomainPrefix: p.subdomainPrefix,
      health: { path: p.healthPath || '/', expect: p.healthExpect || 200 },
      theme: { has_skin: p.hasSkin },
      disguise: (p as { disguise?: { name: string; icon: string; url: string } }).disguise,
    }));
  }
  // 回退：开发时直接扫描 plugins/ 目录
  const pluginsDir = path.join(process.cwd(), '..', '..', 'plugins');
  if (!fs.existsSync(pluginsDir)) return [];
  const entries = fs
    .readdirSync(pluginsDir)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.'))
    .filter((d) => fs.statSync(path.join(pluginsDir, d)).isDirectory());
  const list: PluginManifest[] = [];
  for (const dir of entries) {
    const file = path.join(pluginsDir, dir, 'manifest.yml');
    if (!fs.existsSync(file)) continue;
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) as PluginManifest;
    if (doc.ingress?.mode === 'subdomain') list.push(doc);
  }
  list.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.weight - b.weight || a.name.localeCompare(b.name)
  );
  return list;
}

declare global {
  // eslint-disable-next-line no-var
  var __meiPluginsCache: PluginManifest[] | undefined;
}
export function getPlugins(): PluginManifest[] {
  if (!global.__meiPluginsCache) {
    global.__meiPluginsCache = loadManifests();
  }
  return global.__meiPluginsCache;
}

export function getPluginUrl(manifest: PluginManifest, _rootDomain: string): string {
  // 单镜像模式：url 为同源子路径（/novels, /link 等）
  if (process.env.MEI_MODE === 'single') {
    const path = manifest.subdomainPrefix || manifest.id;
    return `/${path}`;
  }
  // 多容器模式：url 为子域名
  if (manifest.subdomainPrefix) {
    return `http://${manifest.subdomainPrefix}.${_rootDomain}`;
  }
  const host = manifest.ingress.host || '';
  if (host && !host.includes('${')) {
    return `http://${host}`;
  }
  const prefix = (host.match(/\$\{SUBDOMAIN_([A-Z0-9_]+)\}/) || [])[1];
  const sub = prefix ? prefix.toLowerCase() : manifest.id;
  return `http://${sub}.${_rootDomain}`;
}

void CATEGORY_LABELS;
