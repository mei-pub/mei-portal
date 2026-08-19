import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { getPanelConfig, savePanelConfig, normalizeConfig } from '@/lib/panel-store';

export const dynamic = 'force-dynamic';

// GET /api/panel — 读取主页配置（公开：首页 SSR 与渲染都需要）
export async function GET() {
  return NextResponse.json(getPanelConfig());
}

// PUT /api/panel — 保存主页配置（需登录；白名单化校验在 normalizeConfig）
export async function PUT(req: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const config = normalizeConfig(body);
    savePanelConfig(config);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error('Failed to save panel config:', error);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}
