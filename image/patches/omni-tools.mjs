// omni-tools patch —— Vite base + BrowserRouter basename + 顶栏注入
import fs from 'fs';

// ---- 1. vite.config base ----
for (const vf of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
  if (!fs.existsSync(vf)) continue;
  let c = fs.readFileSync(vf, 'utf8');
  if (c.includes("base:")) break;
  // 在 defineConfig 的对象里注入 base
  c = c.replace(/(defineConfig\s*\(\s*\{)/, `$1\n  base: '/tools/',`);
  fs.writeFileSync(vf, c);
  console.log('[patch] omni-tools: vite base=/tools/ in ' + vf);
  break;
}

// ---- 2. BrowserRouter basename ----
function patchRouter(file) {
  if (!fs.existsSync(file)) return false;
  let c = fs.readFileSync(file, 'utf8');
  if (c.includes('basename')) return false;
  // <BrowserRouter> → <BrowserRouter basename={import.meta.env.BASE_URL}>
  c = c.replace(/<BrowserRouter>/, '<BrowserRouter basename={import.meta.env.BASE_URL}>');
  // 若用 alias <BrowserRouter>，保留
  fs.writeFileSync(file, c);
  console.log('[patch] omni-tools: BrowserRouter basename in ' + file);
  return true;
}
// 常见入口
const routerFiles = [
  'src/components/App.tsx', 'src/App.tsx', 'src/main.tsx', 'src/index.tsx',
  'src/components/App.jsx', 'src/App.jsx', 'src/main.jsx', 'src/index.jsx',
];
let patched = false;
for (const rf of routerFiles) {
  if (patchRouter(rf)) { patched = true; break; }
}
if (!patched) console.log('[patch] omni-tools: 未找到 BrowserRouter，跳过');

// ---- 3. index.html 根绝对路径修正（favicon/manifest）----
const indexHtml = 'index.html';
if (fs.existsSync(indexHtml)) {
  let h = fs.readFileSync(indexHtml, 'utf8');
  // /favicon.svg → /tools/favicon.svg 等（Vite 不改写非打包入口的绝对路径）
  h = h.replace(/(href|src)="\/(favicon|apple-touch|site\.webmanifest|assets)/g, '$1="/tools/$2');
  fs.writeFileSync(indexHtml, h);
  console.log('[patch] omni-tools: index.html 绝对路径已修正');
}

// ---- 4. i18n loadPath 子路径修正 ----
// omni-tools 默认从 /locales/ 加载，子路径下需 /tools/locales/
const i18nFile = 'src/i18n/index.ts';
if (fs.existsSync(i18nFile)) {
  let c = fs.readFileSync(i18nFile, 'utf8');
  if (c.includes("'/locales/")) {
    c = c.replace("'/locales/", "'/tools/locales/");
    fs.writeFileSync(i18nFile, c);
    console.log('[patch] omni-tools: i18n loadPath → /tools/locales/');
  }
}

console.log('[patch] omni-tools 完成');

