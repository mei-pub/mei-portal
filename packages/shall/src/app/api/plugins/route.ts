import { NextResponse } from 'next/server';
import { getPlugins, getPluginUrl, expandTutorialLibraries } from '@/lib/plugins';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  // 先用 getPluginUrl 计算每个插件的同源子路径 url
  const pluginsWithUrl = getPlugins().map((p) => ({
    ...p,
    url: getPluginUrl(p, rootDomain),
  }));

  // 多书架模式：异步展开 tutorial 为每个书架一个入口
  const expanded = await expandTutorialLibraries(pluginsWithUrl);

  return NextResponse.json(expanded);
}
