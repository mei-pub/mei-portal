# mei-link（内网穿透）

上游：https://github.com/tomtrije/mei-link（仅集成 Docker 客户端）

## 集成说明
- **本地构建**（git submodule `packages/mei-link`，context=`client/docker`），无需 GHCR 认证（上游为私有仓库）
- 内部端口：17420，数据卷 `/data`
- 原生 HTML/CSS/JS，无框架，协调 CSS 覆盖力最强。
- 首次启动需配置 frps 连接参数（管理 UI 内操作）。
- 升级：`cd packages/mei-link && git pull`，然后 `docker compose build mei-link`。
