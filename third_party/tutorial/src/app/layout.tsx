import type { Metadata, Viewport } from "next";
import "./globals.css";
import ToastContainer from "@/components/Toast";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "小说阅读",
  description: "个人小说站点（普通/隐秘站点）",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "小说阅读",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: '/novels/manifest.json',
  icons: {
    icon: [
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning><script id="mei-topbar-script" src="/__shell/topbar.js" data-app="tutorial"></script>
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
