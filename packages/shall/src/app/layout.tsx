import type { Metadata } from 'next';
import './globals.css';
import { getPanelConfig } from '@/lib/panel-store';
import MusicDock from '@/components/MusicDock';
import NavBridge from '@/components/NavBridge';

// 标题/描述跟随主页设置（logoText），图标用默认 Logo（src/app/icon.svg）
export async function generateMetadata(): Promise<Metadata> {
  let brand = 'mei-allin';
  try {
    const panel = getPanelConfig();
    if (panel.style.logoText) brand = panel.style.logoText;
  } catch {}
  return {
    title: brand,
    description: '统一应用门户',
  };
}

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // 服务端注入真实 ROOT_DOMAIN，供客户端拼接子域名 url
  // 避免客户端猜测根域（nip.io 等多级域名会猜错）
  const rootDomain = process.env.ROOT_DOMAIN || 'allin.local';
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__MEI_ROOT_DOMAIN__=${JSON.stringify(rootDomain)};`,
          }}
        />
        {children}
        {/* 注入式顶栏的挂载点：绝不能让 topbar.js 直接改 body 子节点顺序，
            否则 React 卸载时对账失败（removeChild of null）会清空整页 */}
        <div id="mei-shell-slot" />
        {/* 同源跳转收敛为客户端路由，保证常驻播放条与音频不被整页加载销毁 */}
        <NavBridge />
        {/* 常驻音乐播放条：所有门户页面（含 /app 子应用承载页）始终存在 */}
        <MusicDock />
      </body>
    </html>
  );
}
