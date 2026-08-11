# LunaTV（影视门户）

上游：https://github.com/MoonTechLab/LunaTV

## 集成说明
- 镜像：`ghcr.io/moontechlab/lunatv:latest`
- 内部端口：3000，依赖 kvrocks（已在 compose 中）
- 默认登录 admin / admin123
- 需在管理后台（/admin）配置视频源（Apple CMS V10 API 格式）
- tailwind.config 的 primary 色阶为蓝色，本协调 CSS 用 CSS 变量近似覆盖。
