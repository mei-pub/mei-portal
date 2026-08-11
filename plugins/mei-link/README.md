# mei-link（内网穿透）

上游：https://github.com/tomtrije/mei-link（仅集成 Docker 客户端）

## 集成说明
- 镜像：`ghcr.io/tomtrije/meilink-client:latest`
- 内部端口：17420，数据卷 `/data`
- 原生 HTML/CSS/JS，无框架，协调 CSS 覆盖力最强。
- 首次启动需配置 frps 连接参数（管理 UI 内操作）。
