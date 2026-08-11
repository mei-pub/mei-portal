# sun-panel（主页面板）

上游：https://github.com/hslr-s/sun-panel

## 集成说明
- 镜像：`hslr/sun-panel:latest`
- 内部端口：3002，卷 conf/uploads/database
- 本项目用自研 Shell 作主门户；sun-panel 作为可选"经典启动器"保留。
- sun-panel 自带「自定义 CSS/JS」注入能力，可在其后台做更深度的主题统一。
- Naive UI 主题色由 JS 注入，纯 CSS 协调力有限。
