import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'mei-allin',
  description: '统一应用门户',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-mei-theme="dark">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
