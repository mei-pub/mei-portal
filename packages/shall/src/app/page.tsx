import { getPlugins, getPluginUrl, expandTutorialLibraries } from '@/lib/plugins';
import type { ClientPlugin } from '@/lib/categories';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PortalClient from '@/components/PortalClient';

// 强制动态渲染：expandTutorialLibraries 需要运行时 fetch tutorial
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // 门禁
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }

  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';

  // 先用 getPluginUrl 计算每个插件的同源子路径 url
  const pluginsWithUrl = getPlugins().map((p) => ({
    ...p,
    url: getPluginUrl(p, rootDomain),
  }));

  // 多书架模式：异步展开 tutorial 为每个书架一个入口
  const expanded = await expandTutorialLibraries(pluginsWithUrl);

  // 转为客户端安全的数据（去 endpoint 等服务端字段）
  const items: { plugin: ClientPlugin; url: string }[] = expanded.map((p) => ({
    url: p.url,
    plugin: {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      category: p.category,
      weight: p.weight,
      url: p.url,
      subdomainPrefix: p.subdomainPrefix,
    },
  }));

  return <PortalClient items={items} />;
}
