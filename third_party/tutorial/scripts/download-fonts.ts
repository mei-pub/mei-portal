/**
 * 字体预下载脚本
 * 从 Google Fonts CDN 下载字体 CSS 和字体文件到本地 data/fonts/ 目录。
 * 运行方式: npx tsx scripts/download-fonts.ts
 * 
 * 下载完成后，/api/fonts 路由将纯从本地文件提供服务，不访问外网。
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const CSS_DIR = path.join(FONTS_DIR, 'css');
const FILES_DIR = path.join(FONTS_DIR, 'files');

// Font definitions
const FONT_FAMILIES: Record<string, string> = {
  'Noto Serif SC': '/css2?family=Noto+Serif+SC:wght@400;700&display=swap',
  'Noto Sans SC': '/css2?family=Noto+Sans+SC:wght@400;700&display=swap',
  'LXGW WenKai': 'jsdelivr-lxgw',
  'Ma Shan Zheng': '/css2?family=Ma+Shan+Zheng&display=swap',
  'ZCOOL XiaoWei': '/css2?family=ZCOOL+XiaoWei&display=swap',
  'ZCOOL KuaiLe': '/css2?family=ZCOOL+KuaiLe&display=swap',
  'ZCOOL QingKe HuangYou': '/css2?family=ZCOOL+QingKe+HuangYou&display=swap',
  'Long Cang': '/css2?family=Long+Cang&display=swap',
  'Zhi Mang Xing': '/css2?family=Zhi+Mang+Xing&display=swap',
  'Liu Jian Mao Cao': '/css2?family=Liu+Jian+Mao+Cao&display=swap',
};

const CDN_SOURCES = [
  'https://fonts.googleapis.com',
  'https://fonts.loli.net',
  'https://fonts.googleapis.cn',
];

// ── Helpers ──

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      req.destroy(new Error('Timeout'));
    }, 30000);
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => { clearTimeout(timeout); resolve(data); });
    });
    req.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      req.destroy(new Error('Timeout'));
    }, 120000);
    const file = fs.createWriteStream(dest);
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        clearTimeout(timeout);
        resolve();
      });
    });
    req.on('error', err => {
      clearTimeout(timeout);
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function fetchFromCDNs(cssPath: string): Promise<string | null> {
  for (const cdn of CDN_SOURCES) {
    try {
      console.log(`  Trying ${cdn}...`);
      const css = await fetchText(cdn + cssPath);
      if (css && css.includes('@font-face')) return css;
    } catch (err: any) {
      console.log(`  ✗ ${cdn} failed: ${err.message}`);
    }
  }
  return null;
}

// Special downloader for LXGW WenKai — try multiple CDN sources
async function downloadLXGWWenKai() {
  const family = 'LXGW WenKai';
  const cssFileName = 'LXGW_WenKai.css';
  const cssFilePath = path.join(CSS_DIR, cssFileName);

  console.log(`↓ ${family}`);

  const localName = 'LXGWWenKai-Regular.ttf';
  const localPath = path.join(FILES_DIR, localName);

  if (!fs.existsSync(localPath)) {
    // Multiple download sources
    const sources = [
      'https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@v1.501/fonts/TTF/LXGWWenKai-Regular.ttf',
      'https://registry.npmmirror.com/lxgw-wenkai-web-font/1.7.0/files/LXGWWenKai-Regular.woff2',
      'https://unpkg.com/lxgw-wenkai-web-font@1.7.0/LXGWWenKai-Regular.woff2',
      'https://github.com/lxgw/LxgwWenKai/releases/download/v1.501/LXGWWenKai-Regular.ttf',
    ];

    let downloaded = false;
    for (const src of sources) {
      try {
        process.stdout.write(`  Trying ${new URL(src).hostname}...`);
        await downloadFile(src, localPath);
        const size = fs.statSync(localPath).size;
        console.log(` ${Math.round(size / 1024)}KB`);
        downloaded = true;
        break;
      } catch (err: any) {
        console.log(` ✗ ${err.message}`);
      }
    }
    if (!downloaded) {
      console.log(`  ✗ FAILED: All sources unavailable`);
      return;
    }
  } else {
    console.log(`  ✓ ${localName} (cached)`);
  }

  // Generate CSS with @font-face pointing to local API
  const css = `@font-face {
  font-family: 'LXGW WenKai';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/api/fonts?file=${encodeURIComponent(localName)}') format('truetype');
}`;
  fs.writeFileSync(cssFilePath, css, 'utf-8');
  console.log(`  → Saved ${cssFileName}\n`);
}

// ── Main ──

async function main() {
  ensureDir(CSS_DIR);
  ensureDir(FILES_DIR);

  console.log('=== 字体预下载脚本 ===\n');

  for (const [family, cssPath] of Object.entries(FONT_FAMILIES)) {
    const cssFileName = family.replace(/[^a-zA-Z0-9]/g, '_') + '.css';
    const cssFilePath = path.join(CSS_DIR, cssFileName);

    // Check if already downloaded
    if (fs.existsSync(cssFilePath)) {
      // Verify all referenced font files exist
      const existingCss = fs.readFileSync(cssFilePath, 'utf-8');
      const fileRefs = [...existingCss.matchAll(/file=([^&"')]+)/g)];
      const allExist = fileRefs.every(m => fs.existsSync(path.join(FILES_DIR, decodeURIComponent(m[1]))));
      if (allExist) {
        console.log(`✓ ${family} — already cached, skipping`);
        continue;
      }
      console.log(`↻ ${family} — cache incomplete, re-downloading`);
    } else {
      console.log(`↓ ${family}`);
    }

    // Special handling for LXGW WenKai (use GitHub release via jsDelivr)
    if (cssPath === 'jsdelivr-lxgw') {
      await downloadLXGWWenKai();
      continue;
    }

    // Fetch CSS
    const cssContent = await fetchFromCDNs(cssPath);
    if (!cssContent) {
      console.log(`  ✗ FAILED: Could not fetch CSS for ${family} from any CDN\n`);
      continue;
    }

    // Extract font file URLs
    const fontUrlRegex = /url\((https?:\/\/[^)]+)\)/g;
    let match: RegExpExecArray | null;
    let rewrittenCss = cssContent;
    const fontDownloads: { originalUrl: string; localName: string }[] = [];

    while ((match = fontUrlRegex.exec(cssContent)) !== null) {
      const originalUrl = match[1];
      const urlObj = new URL(originalUrl);
      const pathPart = urlObj.pathname.split('/').pop() || 'font';
      const ext = path.extname(pathPart) || '.woff2';
      const localName = pathPart.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localPath = path.join(FILES_DIR, localName);

      fontDownloads.push({ originalUrl, localName });

      // Download font file
      if (fs.existsSync(localPath)) {
        console.log(`  ✓ ${localName} (cached)`);
      } else {
        try {
          process.stdout.write(`  ↓ ${localName}...`);
          await downloadFile(originalUrl, localPath);
          const size = fs.statSync(localPath).size;
          console.log(` ${Math.round(size / 1024)}KB`);
        } catch (err: any) {
          console.log(` FAILED: ${err.message}`);
        }
      }

      // Rewrite URL to local API endpoint
      const localUrl = `/api/fonts?file=${encodeURIComponent(localName)}`;
      rewrittenCss = rewrittenCss.replace(originalUrl, localUrl);
    }

    // Save rewritten CSS
    fs.writeFileSync(cssFilePath, rewrittenCss, 'utf-8');
    console.log(`  → Saved ${cssFileName}\n`);
  }

  // Summary
  console.log('=== 下载完成 ===');
  const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css'));
  const fontFiles = fs.readdirSync(FILES_DIR);
  const totalSize = fontFiles.reduce((sum, f) => sum + fs.statSync(path.join(FILES_DIR, f)).size, 0);
  console.log(`CSS files: ${cssFiles.length}`);
  console.log(`Font files: ${fontFiles.length}`);
  console.log(`Total size: ${Math.round(totalSize / 1024 / 1024 * 10) / 10} MB`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
