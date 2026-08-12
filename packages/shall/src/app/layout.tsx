import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'mei-allin',
  description: '统一应用门户',
  manifest: '/manifest.json',
};

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
      </body>
    </html>
  );
}
