# tutorial（小说书架）

上游：https://github.com/tomtrije/tutorial（带蜘蛛纸牌游戏伪装的小说站）

## 集成说明
- 镜像：`ghcr.io/tomtrije/tutorial:latest`
- 内部端口：3000，数据卷 `/app/data`
- 上游已使用 CSS 变量（`--primary` 等），与 mei-tokens 天然兼容，协调最简单。
- 协调要点：顶栏玻璃化、卡片统一圆角、阅读区护眼底色。
