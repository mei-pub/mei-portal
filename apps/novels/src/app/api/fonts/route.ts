import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const _rawDir = process.env.DATA_DIR || process.cwd();
const DATA_DIR = path.isAbsolute(_rawDir) ? _rawDir : path.resolve(process.cwd(), _rawDir);
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const CSS_DIR = path.join(FONTS_DIR, 'css');
const FILES_DIR = path.join(FONTS_DIR, 'files');

// Family name → cached CSS filename
const FAMILY_MAP: Record<string, string> = {
  'Noto Serif SC': 'Noto_Serif_SC.css',
  'Noto Sans SC': 'Noto_Sans_SC.css',
  'LXGW WenKai': 'LXGW_WenKai.css',
  'Ma Shan Zheng': 'Ma_Shan_Zheng.css',
  'ZCOOL XiaoWei': 'ZCOOL_XiaoWei.css',
  'ZCOOL KuaiLe': 'ZCOOL_KuaiLe.css',
  'ZCOOL QingKe HuangYou': 'ZCOOL_QingKe_HuangYou.css',
  'Long Cang': 'Long_Cang.css',
  'Zhi Mang Xing': 'Zhi_Mang_Xing.css',
  'Liu Jian Mao Cao': 'Liu_Jian_Mao_Cao.css',
};

// GET /api/fonts?family=XXX  → returns cached CSS
// GET /api/fonts?file=XXX    → returns cached font file
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get('family');
  const file = searchParams.get('file');

  // Serve a cached font file
  if (file) {
    const safeName = file.replace(/\.\./g, '').replace(/\//g, '');
    const filePath = path.join(FILES_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Font file not found' }, { status: 404 });
    }
    const ext = path.extname(filePath);
    const mimeMap: Record<string, string> = {
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
    };
    const data = fs.readFileSync(filePath);
    return new NextResponse(data, {
      headers: {
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Serve font CSS
  if (!family || !FAMILY_MAP[family]) {
    return NextResponse.json({
      error: 'Invalid family',
      available: Object.keys(FAMILY_MAP),
    }, { status: 400 });
  }

  const cssPath = path.join(CSS_DIR, FAMILY_MAP[family]);
  if (!fs.existsSync(cssPath)) {
    return NextResponse.json({
      error: 'Font not available on server. Run: npx tsx scripts/download-fonts.ts',
      family,
    }, { status: 404 });
  }

  const css = fs.readFileSync(cssPath, 'utf-8');
  return new NextResponse(css, {
    headers: {
      'Content-Type': 'text/css',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
