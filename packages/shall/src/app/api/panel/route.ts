import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { getPanelConfig, savePanelConfig, type PanelConfig } from '@/lib/panel-store';

export const dynamic = 'force-dynamic';

// GET /api/panel — 读取主页配置（公开：首页 SSR 与渲染都需要）
export async function GET() {
  return NextResponse.json(getPanelConfig());
}

// PUT /api/panel — 保存主页配置（需登录）
export async function PUT(req: Request) {
  if (!isLoggedIn()) {
    return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 });
  }
  try {
    const body = (await req.json()) as PanelConfig;
    // 白名单化 + 规范化
    const config: PanelConfig = {
      background: {
        url: String(body?.background?.url || '').slice(0, 2048),
        mask: Math.min(0.9, Math.max(0, Number(body?.background?.mask) || 0)),
        blur: Math.min(24, Math.max(0, Number(body?.background?.blur) || 0)),
      },
      customItems: (Array.isArray(body?.customItems) ? body.customItems : [])
        .filter((i) => i && i.name && i.url)
        .slice(0, 60)
        .map((i, idx) => ({
          id: String(i.id || `c${Date.now()}-${idx}`).slice(0, 40),
          name: String(i.name).slice(0, 30),
          url: String(i.url).slice(0, 2048),
          icon: String(i.icon || 'lucide:link').slice(0, 60),
        })),
    };
    savePanelConfig(config);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error('Failed to save panel config:', error);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}
