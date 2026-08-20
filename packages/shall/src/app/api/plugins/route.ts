import { NextResponse } from 'next/server';
import { getPlugins, getPluginUrl } from '@/lib/plugins';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  // 单一固定入口（含「小说阅读」），站点列表由顶栏面板通过 /api/novels/sites 获取
  const pluginsWithUrl = getPlugins().map((p) => ({
    ...p,
    url: getPluginUrl(p, rootDomain),
  }));

  return NextResponse.json(pluginsWithUrl);
}
