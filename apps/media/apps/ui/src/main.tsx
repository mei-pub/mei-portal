import "./utils/sentry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { tdApp } from "./utils";
import "./i18n";
import "./globals.css";
import { BrowserRouter } from "react-router-dom";

tdApp.init();

// mei-portal 集成：web 部署在 /downloads 子路径下，router 用 basename 适配深链
// （原 nginx Location.pathname getter 补丁在部分环境不生效，导致 /downloads/settings 等深链 404）
// 桌面/独立部署仍在根路径，basename 仅在检测到 /downloads 前缀时启用
const routerBasename = window.location.pathname.startsWith("/downloads")
  ? "/downloads"
  : undefined;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
