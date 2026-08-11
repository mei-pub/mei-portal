// =============================================================================
// 构建主题资产：聚合到 packages/shall/public/__theme/
//   - tokens.css    ← src/theme/tokens.css（直接拷贝）
//   - loader.js     ← src/theme/loader.js（直接拷贝）
//   - <app>.css     ← plugins/<app>/theme.css（仅 has_skin=true 的应用）
// 用法: node scripts/build-theme.mjs
// =============================================================================
import { copyFileSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const THEME_SRC = join(ROOT, 'packages', 'shall', 'src', 'theme');
const THEME_OUT = join(ROOT, 'packages', 'shall', 'public', '__theme');

mkdirSync(THEME_OUT, { recursive: true });

// 1. tokens.css
copyFileSync(join(THEME_SRC, 'tokens.css'), join(THEME_OUT, 'tokens.css'));
console.log('✓ tokens.css');

// 2. loader.js
copyFileSync(join(THEME_SRC, 'loader.js'), join(THEME_OUT, 'loader.js'));
console.log('✓ loader.js');

// 3. 各应用协调 CSS
const dirs = readdirSync(PLUGINS_DIR).filter((d) => {
  if (d.startsWith('_') || d.startsWith('.')) return false;
  return statSync(join(PLUGINS_DIR, d)).isDirectory();
});

let count = 0;
for (const dir of dirs) {
  const manifestFile = join(PLUGINS_DIR, dir, 'manifest.yml');
  if (!existsSync(manifestFile)) continue;
  const manifest = yaml.load(readFileSync(manifestFile, 'utf8'));
  if (!manifest.theme?.has_skin) continue;
  const cssFile = join(PLUGINS_DIR, dir, 'theme.css');
  if (!existsSync(cssFile)) {
    console.warn(`⚠ ${dir}: has_skin=true 但缺 theme.css，跳过`);
    continue;
  }
  // 头部加注释标识来源
  const header = `/* ${dir} 协调 CSS — 由 scripts/build-theme.mjs 从 plugins/${dir}/theme.css 生成 */\n`;
  writeFileSync(join(THEME_OUT, `${dir}.css`), header + readFileSync(cssFile, 'utf8'));
  console.log(`✓ ${dir}.css`);
  count++;
}
console.log(`✓ 完成：${count} 个应用协调 CSS`);

// 4. 聚合 plugins.json —— Shell 运行时读此文件而非扫描文件系统
//    这样 standalone Docker 容器无需打包 plugins/ 目录
const allPlugins = [];
for (const dir of dirs) {
  const manifestFile = join(PLUGINS_DIR, dir, 'manifest.yml');
  if (!existsSync(manifestFile)) continue;
  const manifest = yaml.load(readFileSync(manifestFile, 'utf8'));
  if (manifest.ingress?.mode !== 'subdomain') continue;
  // 推导子域名前缀：从 host 的 ${SUBDOMAIN_X} 占位或回退到 id
  let subdomainPrefix = manifest.id;
  const m = (manifest.ingress.host || '').match(/\$\{SUBDOMAIN_([A-Z0-9_]+)\}/);
  if (m) subdomainPrefix = m[1].toLowerCase();
  allPlugins.push({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description || '',
    icon: manifest.icon,
    category: manifest.category,
    weight: manifest.weight ?? 50,
    subdomainPrefix,
    endpoint: manifest.endpoint,
    healthPath: manifest.health?.path || '/',
    healthExpect: manifest.health?.expect || 200,
    hasSkin: !!manifest.theme?.has_skin,
  });
}
// 排序：category → weight → name
allPlugins.sort(
  (a, b) =>
    a.category.localeCompare(b.category) ||
    (a.weight - b.weight) ||
    a.name.localeCompare(b.name)
);
writeFileSync(join(THEME_OUT, 'plugins.json'), JSON.stringify(allPlugins, null, 2));
console.log(`✓ plugins.json（${allPlugins.length} 个应用）`);
