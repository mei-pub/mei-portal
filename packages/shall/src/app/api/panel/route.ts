import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { getPanelConfig, savePanelConfig, normalizeConfig } from '@/lib/panel-store';

export const dynamic = 'force-dynamic';

// GET /api/panel — 读取主页配置（公开：首页 SSR 与渲染都需要）
export async function GET() {
  return NextResponse.json(getPanelConfig());
}

// PUT /api/panel — 保存主页配置（需登录；白名单化校验在 normalizeConfig）
// 支持部分更新：body 与现有配置合并（background/style 深合并），避免只传部分字段时清空其它配置
export async function PUT(req: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const existing = getPanelConfig();
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const merged = {
      ...existing,
      ...b,
      background: { ...existing.background, ...((b.background as object) || {}) },
      style: { ...existing.style, ...((b.style as object) || {}) },
    };
    const config = normalizeConfig(merged);
    savePanelConfig(config);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error('Failed to save panel config:', error);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}
