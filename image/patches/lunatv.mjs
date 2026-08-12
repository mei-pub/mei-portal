// lunatv patch —— basePath=/tv + 顶栏注入 + localstorage 单密码模式
import fs from 'fs';
import path from 'path';

const BASE = '/tv';

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) fn(p);
  }
}

// ---- 1. next.config basePath ----
const cfgFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
for (const cf of cfgFiles) {
  if (!fs.existsSync(cf)) continue;
  let c = fs.readFileSync(cf, 'utf8');
  if (!c.includes('basePath')) {
    // 注入 basePath
    c = c.replace(/(const\s+nextConfig\s*=\s*\{)/, `$1\n  basePath: '${BASE}',`);
    if (!c.includes('basePath')) {
      c = c.replace(/(module\.exports\s*=\s*\{)/, `$1\n  basePath: '${BASE}',`);
    }
    // 关闭构建期 lint（避免注入的 script 触发 no-sync-scripts）
    if (!c.includes('ignoreDuringBuilds')) {
      c = c.replace(/eslint:\s*\{[^}]*\}/, `eslint: { ignoreDuringBuilds: true }`);
    }
    fs.writeFileSync(cf, c);
    console.log('[patch] lunatv: basePath=' + BASE + ' in ' + cf);
    break;
  }
}

// ---- 2. 顶栏注入到 layout ----
const layoutCandidates = ['src/app/layout.tsx', 'src/app/layout.jsx', 'app/layout.tsx', 'app/layout.jsx'];
for (const lf of layoutCandidates) {
  if (!fs.existsSync(lf)) continue;
  let layout = fs.readFileSync(lf, 'utf8');
  if (layout.includes('mei-topbar-script')) break;
  // eslint-disable-next-line @next/next/no-sync-scripts 行内注释 + script
  layout = layout.replace(
    /(<body[^>]*>)/,
    `$1{/* eslint-disable-next-line @next/next/no-sync-scripts */}<script id="mei-topbar-script" src="/__shell/topbar.js" data-app="lunatv"></script>`
  );
  fs.writeFileSync(lf, layout);
  console.log('[patch] lunatv: 顶栏注入到 ' + lf);
  break;
}

console.log('[patch] lunatv 完成');
