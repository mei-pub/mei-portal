// tutorial patch —— basePath + API 路径修正 + 顶栏注入
import fs from 'fs';
import path from 'path';

const BASE = '/novels';

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) fn(p);
  }
}

// ---- 1. basePath ----
const cfgPath = 'next.config.ts';
let cfg = fs.readFileSync(cfgPath, 'utf8');
if (!cfg.includes('basePath')) {
  cfg = cfg.replace(
    /const nextConfig:\s*NextConfig\s*=\s*\{/,
    `const nextConfig: NextConfig = {\n  basePath: '${BASE}',\n  assetPrefix: '${BASE}',`
  );
  fs.writeFileSync(cfgPath, cfg);
  console.log('[patch] tutorial: basePath=' + BASE);
}

// ---- 2. 修正前端 fetch 的 /api/ 绝对路径为带 basePath ----
// 必须保留各自的引号类型（单引号/双引号/反引号），避免破坏模板字符串
let apiFixed = 0;
walk('src', (f) => {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;
  // 双引号 "/api/ → "/novels/api/
  let nc = c.replace(/fetch\(\s*"(\/api\/)/g, `fetch("${BASE}$1`);
  if (nc !== c) { c = nc; changed = true; }
  // 单引号 '/api/ → '/novels/api/
  nc = c.replace(/fetch\(\s*'(\/api\/)/g, `fetch('${BASE}$1`);
  if (nc !== c) { c = nc; changed = true; }
  // 反引号 `/api/ → `/novels/api/（保留模板字符串）
  nc = c.replace(/fetch\(\s*`(\/api\/)/g, 'fetch(`' + BASE + '$1');
  if (nc !== c) { c = nc; changed = true; }
  // axios/fetch 其它形式：("/api 无引号开头的情况已覆盖
  if (changed) {
    fs.writeFileSync(f, c);
    apiFixed++;
  }
});
console.log('[patch] tutorial: 修正 ' + apiFixed + ' 个文件的 API 路径');

// ---- 2.5 初始化默认 library（无密码，免登录即可使用）----
const dbPath = 'src/lib/db.ts';
if (fs.existsSync(dbPath)) {
  let db = fs.readFileSync(dbPath, 'utf8');
  if (!db.includes('DEFAULT_LIB_SEED')) {
    // 在 schema exec 后插入默认 library 创建
    db = db.replace(
      /(\);\s*\n\s*\/\/ ── Interfaces ──)/,
      `);

// ── DEFAULT_LIB_SEED: 首次启动若无 library 则创建默认无密码 library ──
const libCount = db.prepare('SELECT COUNT(*) as c FROM libraries').get() as { c: number };
if (libCount && libCount.c === 0) {
  db.prepare("INSERT INTO libraries (name, password) VALUES (?, ?)").run('我的书架', '');
  console.log('[tutorial] 已创建默认书架');
}

// ── Interfaces ──`
    );
    fs.writeFileSync(dbPath, db);
    console.log('[patch] tutorial: 注入默认 library 初始化');
  }
}

// ---- 2.6 移除 AuthProvider 的 401 reload 死循环 ----
const authPath = 'src/components/AuthProvider.tsx';
if (fs.existsSync(authPath)) {
  let auth = fs.readFileSync(authPath, 'utf8');
  // 把 window.location.reload() 改为只设置未认证状态（不死循环）
  auth = auth.replace(/window\.location\.reload\(\);/g, '/* mei: 移除死循环 reload */ forceHideFn && forceHideFn();');
  fs.writeFileSync(authPath, auth);
  console.log('[patch] tutorial: 移除 AuthProvider 401 reload 死循环');
}

// ---- 3. 修正 manifest.json / favicon 等根绝对路径（layout 里的 metadata）----
const layoutPath = 'src/app/layout.tsx';
if (fs.existsSync(layoutPath)) {
  let layout = fs.readFileSync(layoutPath, 'utf8');
  // manifest: '/manifest.json' → '/novels/manifest.json'
  layout = layout.replace(/manifest:\s*['"]\/manifest\.json['"]/g, `manifest: '${BASE}/manifest.json'`);
  fs.writeFileSync(layoutPath, layout);
}

// ---- 4. 顶栏注入到 layout ----
let layout = fs.readFileSync(layoutPath, 'utf8');
if (!layout.includes('mei-topbar-script')) {
  // 在 <body> 标签后注入顶栏 script（作为 React 元素，hydration 时保留）
  layout = layout.replace(
    /(<body[^>]*>)/,
    `$1<script id="mei-topbar-script" src="/__shell/topbar.js" data-app="tutorial"></script>`
  );
  fs.writeFileSync(layoutPath, layout);
  console.log('[patch] tutorial: 顶栏 script 注入到 layout');
}

console.log('[patch] tutorial 完成');
