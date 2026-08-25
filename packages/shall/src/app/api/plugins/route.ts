import { NextResponse } from 'next/server';
import { getPlugins, getPluginUrl } from '@/lib/plugins';
import {
  getKnownPublicOrigins,
  getPublicOrigin,
  normalizeBuiltinUrl,
} from '@/lib/navigation-url';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  const publicOrigin = getPublicOrigin(
    req.headers.get('x-forwarded-host') || req.headers.get('host'),
    req.headers.get('x-forwarded-proto')
  );
  const knownPublicOrigins = getKnownPublicOrigins(process.env.PUBLIC_ORIGINS);
  // 单一固定入口（含「小说阅读」），站点列表由顶栏面板通过 /api/novels/sites 获取
  const pluginsWithUrl = getPlugins().map((p) => ({
    ...p,
    url: normalizeBuiltinUrl(getPluginUrl(p, rootDomain), publicOrigin, knownPublicOrigins),
  }));

  return NextResponse.json(pluginsWithUrl);
}
