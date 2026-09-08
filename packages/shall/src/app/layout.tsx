import type { Metadata } from 'next';
import './globals.css';
import { getPanelConfig } from '@/lib/panel-store';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import MusicDock from '@/components/MusicDock';
import NavBridge from '@/components/NavBridge';

// 标题/描述跟随主页设置（logoText），图标用默认 Logo（src/app/icon.svg）
export async function generateMetadata(): Promise<Metadata> {
  let brand = 'mei-portal';
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
  // 未登录时不渲染外壳组件（NavBridge/MusicDock），登录页不应有播放器等应用能力
  initUserIfNeeded();
  const loggedIn = isLoggedIn();
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
        {/* 注入式顶栏：Shell 自身页面也加载 topbar.js，
            顶栏挂载到 #mei-shell-slot（与子应用 iframe 同构）。
            IS_SHELL=true 时 topbar.js 不注入 body padding-top，
            因为 Shell 页面有自己的布局，不需要悬浮避让。 */}
        {loggedIn && (
          <script src="/__shell/topbar.js" async />
        )}
        {loggedIn && (
          <>
            {/* 同源跳转收敛为客户端路由，保证常驻播放条与音频不被整页加载销毁 */}
            <NavBridge />
            {/* 常驻音乐播放条：仅登录后渲染，登录页不显示 */}
            <MusicDock />
          </>
        )}
      </body>
    </html>
  );
}
