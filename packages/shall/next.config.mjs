/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 输出，便于 docker 最小镜像
  output: 'standalone',
  reactStrictMode: true,
  // 禁用 Next.js 内置 trailing-slash 308 重定向：
  // app 资源路径（/music/, /tv/ 等）由 middleware 内部 rewrite 处理，避免额外往返
  skipTrailingSlashRedirect: true,
  // 静态资源由 public 提供，/__theme/* 直接访问主题文件
  async rewrites() {
    return [];
  },
};

export default nextConfig;
