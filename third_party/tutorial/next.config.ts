import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/novels',
  assetPrefix: '/novels',
  output: "standalone",
  allowedDevOrigins: ["192.168.3.68"],
};

export default nextConfig;
