# tutorial（小说书架）

上游：https://github.com/tomtrije/tutorial（带蜘蛛纸牌游戏伪装的小说站）

## 集成说明
- **本地构建**（git submodule `packages/tutorial`），无需 GHCR 认证（上游为私有仓库）
- 内部端口：3000，数据卷 `/app/data`
- 上游已使用 CSS 变量（`--primary` 等），与 mei-tokens 天然兼容，协调最简单。
- 协调要点：顶栏玻璃化、卡片统一圆角、阅读区护眼底色。
- 升级：`cd packages/tutorial && git pull`，然后 `docker compose build tutorial`。
