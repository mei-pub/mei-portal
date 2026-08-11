/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 输出，便于 docker 最小镜像
  output: 'standalone',
  reactStrictMode: true,
  // 静态资源由 public 提供，/__theme/* 直接访问主题文件
  async rewrites() {
    return [];
  },
};

export default nextConfig;
