import { NextResponse } from 'next/server';
import { isLoggedIn } from '@/lib/auth';
import { getPanelConfig, savePanelConfig, normalizeConfig, syncBuiltinItems } from '@/lib/panel-store';
import { getPlugins, getPluginUrl } from '@/lib/plugins';
import {
  getKnownPublicOrigins,
  getPublicOrigin,
  normalizeBuiltinItemUrls,
} from '@/lib/navigation-url';

export const dynamic = 'force-dynamic';

// GET /api/panel — 读取主页配置（公开：首页 SSR 与渲染都需要）
function publicOrigin(req: Request): URL | null {
  return getPublicOrigin(
    req.headers.get('x-forwarded-host') || req.headers.get('host'),
    req.headers.get('x-forwarded-proto')
  );
}

function canonicalizeBuiltinItems(config: ReturnType<typeof getPanelConfig>) {
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  const plugins = getPlugins().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    url: getPluginUrl(p, rootDomain),
  }));
  return syncBuiltinItems(config, plugins).config;
}

export async function GET(req: Request) {
  const config = getPanelConfig();
  const canonicalConfig = canonicalizeBuiltinItems(config);
  return NextResponse.json(
    normalizeBuiltinItemUrls(canonicalConfig, publicOrigin(req), getKnownPublicOrigins(process.env.PUBLIC_ORIGINS))
  );
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
    return NextResponse.json({
      ok: true,
      config: normalizeBuiltinItemUrls(
        canonicalizeBuiltinItems(config),
        publicOrigin(req),
        getKnownPublicOrigins(process.env.PUBLIC_ORIGINS)
      ),
    });
  } catch (error) {
    console.error('Failed to save panel config:', error);
    return NextResponse.json({ ok: false, error: '保存失败' }, { status: 500 });
  }
}
