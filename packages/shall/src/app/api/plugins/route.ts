import { NextResponse } from 'next/server';
import { getPlugins, getPluginUrl } from '@/lib/plugins';

export const dynamic = 'force-dynamic';

export async function GET() {
  const plugins = getPlugins();
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  return NextResponse.json(
    plugins.map((p) => ({ ...p, url: getPluginUrl(p, rootDomain) }))
  );
}
