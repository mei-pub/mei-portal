import { getPlugins, getPluginUrl } from '@/lib/plugins';
import type { ClientPlugin } from '@/lib/categories';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PortalClient from '@/components/PortalClient';

export default function HomePage() {
  // 门禁
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }

  const plugins = getPlugins();
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';

  // 转为客户端安全的数据（去 endpoint 等服务端字段，补 url）
  const items: { plugin: ClientPlugin; url: string }[] = plugins.map((p) => {
    const url = getPluginUrl(p, rootDomain);
    return {
      url,
      plugin: {
        id: p.id,
        name: p.name,
        description: p.description,
        icon: p.icon,
        category: p.category,
        weight: p.weight,
        url,
        subdomainPrefix: p.subdomainPrefix,
        disguise: p.disguise,
      },
    };
  });

  return <PortalClient items={items} />;
}
