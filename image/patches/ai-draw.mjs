// ai-draw patch —— Vite base + BrowserRouter basename + API 前缀
// Express 不改：nginx 直接服务静态，/draw/api/ 反代到 Express（strip /draw）
import fs from 'fs';

// ---- 1. vite.config base ----
const vf = 'vite.config.ts';
if (fs.existsSync(vf)) {
  let c = fs.readFileSync(vf, 'utf8');
  if (!c.includes("base:")) {
    c = c.replace(/(defineConfig\s*\(\s*\{)/, `$1\n  base: '/draw/',`);
    fs.writeFileSync(vf, c);
    console.log('[patch] ai-draw: vite base=/draw/');
  }
}

// ---- 2. BrowserRouter basename ----
const appFile = 'src/App.tsx';
if (fs.existsSync(appFile)) {
  let c = fs.readFileSync(appFile, 'utf8');
  if (c.includes('<BrowserRouter>') && !c.includes('basename')) {
    c = c.replace(/<BrowserRouter>/, '<BrowserRouter basename={import.meta.env.BASE_URL}>');
    fs.writeFileSync(appFile, c);
    console.log('[patch] ai-draw: BrowserRouter basename');
  }
}

// ---- 3. 前端 API 前缀：所有源码里的硬编码 /api → /draw/api ----
import path from 'node:path';
function walk(dir, fn) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) fn(p);
  }
}
let apiFixed = 0;
walk('src', (f) => {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;
  let nc = c;
  for (const q of ['"', "'", '`']) {
    const re = new RegExp(q + '(/api/)', 'g');
    const nn = nc.replace(re, q + '/draw/$1');
    if (nn !== nc) { nc = nn; changed = true; }
  }
  if (changed) { fs.writeFileSync(f, nc); apiFixed++; }
});
console.log('[patch] ai-draw: 修正 ' + apiFixed + ' 个源文件的 /api/ 路径');

const envFile = '.env';
fs.writeFileSync(envFile, 'VITE_API_BASE_URL=/draw/api\n');
console.log('[patch] ai-draw: .env API 前缀 /draw/api');

console.log('[patch] ai-draw 完成');
