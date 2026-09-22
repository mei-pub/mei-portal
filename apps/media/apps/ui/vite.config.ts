import fs from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = path.resolve(__dirname, "../..");
const appRoot = path.resolve(projectRoot, "apps/electron/app");
const isWeb = process.env.APP_TARGET === "server";

const packageJsonPath = path.resolve(appRoot, "package.json");
const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

// 下载中心跨应用代理（本地验证）：tv / music 的 API 契约服务默认指向
// 本机 mock（高位端口 13003/13005），可用环境变量覆盖到真实服务。
const tvProxyTarget =
  process.env.DEV_TV_PROXY_TARGET || "http://127.0.0.1:13003";
const musicProxyTarget =
  process.env.DEV_MUSIC_PROXY_TARGET || "http://127.0.0.1:13005";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 8555,
    strictPort: true,
    proxy: {
      "/tv": { target: tvProxyTarget, changeOrigin: true },
      "/music": { target: musicProxyTarget, changeOrigin: true },
    },
  },
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.APP_TARGET": JSON.stringify(process.env.APP_TARGET),
  },
  plugins: [react(), tailwindcss()],
  envDir: projectRoot,
  envPrefix: "APP",
  build: {
    outDir: isWeb ? "build/server" : "build/electron",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("antd") || id.includes("@ant-design")) return "antd";
          if (id.includes("zustand") || id.includes("immer")) return "zustand";
          if (
            id.includes("react-dom") ||
            id.includes("react-router-dom") ||
            id.includes("react/")
          )
            return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
