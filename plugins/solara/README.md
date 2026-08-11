# Solara（音乐播放）

上游：https://github.com/akudamatata/Solara

## 集成说明
- 镜像：`ghcr.io/akudamatata/solara:latest`（注意：镜像名是 akud**amatata**，仓库是 akudamatata）
- 内部端口：8787，数据卷 `/data`
- 原生 JS，无框架，最易覆盖
- 动态背景由专辑封面配色算法驱动，协调 CSS 保留该效果，仅统一控件。
