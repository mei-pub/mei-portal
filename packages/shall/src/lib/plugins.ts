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
  ingress: {
    mode: 'subdomain' | 'external';
    host: string;
  };
  auth?: { strategy: 'independent' | 'token_inject' | 'sso' };
  embed?: { iframe: boolean; strip_headers?: string[] };
  theme?: { has_skin: boolean; entry?: string };
  health?: { path: string; expect: number };
  upgrade?: { image?: string; repo?: string };
}

// 构建期：扫描仓库根的 plugins/
function loadManifests(): PluginManifest[] {
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

export function getPluginUrl(manifest: PluginManifest, rootDomain: string): string {
  const host = manifest.ingress.host || '';
  if (host && !host.includes('${')) {
    return `http://${host}`;
  }
  const prefix = (host.match(/\$\{SUBDOMAIN_([A-Z0-9_]+)\}/) || [])[1];
  const sub = prefix ? prefix.toLowerCase() : manifest.id;
  return `http://${sub}.${rootDomain}`;
}

void CATEGORY_LABELS;
