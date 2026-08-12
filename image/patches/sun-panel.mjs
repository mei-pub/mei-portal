// sun-panel patch —— 子路径 /panel 改造
// 1) Go 后端路由加 /panel 前缀组
// 2) Vite base + Vue Router base
// 3) 前端 API base url (.env)
// 4) 顶栏注入到 index.html
import fs from 'fs';
import path from 'path';

const BASE = '/panel';

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else if (/\.(ts|tsx|js|jsx|go)$/.test(e)) fn(p);
  }
}

// ---- 1. Go 路由前缀 ----
const routerFile = 'service/router/A_ENTER.go';
if (fs.existsSync(routerFile)) {
  let c = fs.readFileSync(routerFile, 'utf8');
  if (!c.includes('Group("/panel")')) {
    c = c.replace(/rootRouter\s*:=\s*router\.Group\("\/"\)/, 'rootRouter := router.Group("' + BASE + '")');
    fs.writeFileSync(routerFile, c);
    console.log('[patch] sun-panel: Go 路由前缀 ' + BASE);
  }
}

// ---- 2. Vite base（支持对象和函数两种 defineConfig 写法）----
const vf = 'vite.config.ts';
if (fs.existsSync(vf)) {
  let c = fs.readFileSync(vf, 'utf8');
  if (!c.includes("base:")) {
    // 对象形式: defineConfig({
    c = c.replace(/(defineConfig\(\s*\{)/, `$1\n  base: '${BASE}/',`);
    // 函数形式: defineConfig(({ mode }) => ({ 或 defineConfig((env) => ({
    c = c.replace(/(defineConfig\(\([^)]*\)\s*=>\s*\(\s*\{)/, `$1\n  base: '${BASE}/',`);
    fs.writeFileSync(vf, c);
    console.log('[patch] sun-panel: vite base=' + BASE + '/');
  }
}

// ---- 3. Vue Router base + 前端 /api/ 路径修正 ----
let apiFixed = 0;
walk('src', (f) => {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;
  // createWebHistory(...) 加 base
  if (c.includes('createWebHistory')) {
    c = c.replace(/createWebHistory\(\s*(?:['"][^'"]*['"])?\s*\)/, `createWebHistory('${BASE}/')`);
  }
  // /api/ → /panel/api/
  for (const q of ['"', "'", '`']) {
    const re = new RegExp(q + '(/api/)', 'g');
    const nn = c.replace(re, q + BASE + '$1');
    if (nn !== c) { c = nn; changed = true; }
  }
  if (changed) { fs.writeFileSync(f, c); apiFixed++; }
});
console.log('[patch] sun-panel: 修正 ' + apiFixed + ' 个前端文件');

// ---- 4. .env API url ----
const envFile = '.env';
const envProd = '.env.production';
for (const ef of [envFile, envProd]) {
  if (fs.existsSync(ef)) {
    let c = fs.readFileSync(ef, 'utf8');
    c = c.replace(/VITE_GLOB_API_URL=\/api/, 'VITE_GLOB_API_URL=' + BASE + '/api');
    fs.writeFileSync(ef, c);
  }
}
// 确保 .env 存在
if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, 'VITE_GLOB_API_URL=' + BASE + '/api\n');
console.log('[patch] sun-panel: .env API 前缀');

console.log('[patch] sun-panel 完成');
