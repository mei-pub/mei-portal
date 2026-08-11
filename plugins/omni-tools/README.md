# omni-tools（工具箱）

上游：https://github.com/iib0011/omni-tools

## 集成说明
- 镜像：`iib0011/omni-tools:latest`（nginx 静态站，约 28MB）
- 内部端口：80，无后端无数据库，全客户端处理
- **协调难度最高**：MUI + Emotion 用 inline 样式，CSS 覆盖力有限，仅做配色近似。
- 若需更深度统一，需 fork 上游改 MUI ThemeProvider（违背"不动源码"原则，故仅近似）。
