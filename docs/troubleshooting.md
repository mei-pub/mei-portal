# 部署与排障

## 前置要求

- Docker 20.10+ 与 Docker Compose v2
- 宿主机 7777 端口可用（或自行改 compose 映射）
- 从源码构建需联网拉取 npm 依赖

## 标准部署

### 直接用发布镜像（推荐）

```bash
docker run -d --name mei-portal --restart unless-stopped \
  -p 7777:7777 -v mei-portal-data:/data \
  ghcr.io/mei-pub/mei-portal:latest
```

### 从源码构建（docker compose）

```bash
git clone https://github.com/mei-pub/mei-portal.git
cd mei-portal
docker compose up -d --build
```

浏览器打开 `http://<服务器IP>:7777`，默认账户 `admin` / `mei-portal`（首次登录后请在门户设置里改密码）。

## 常见问题

### Q: 忘记管理员密码

凭据只在 `/data/shell/user.json` 不存在时初始化。忘记密码时：

```bash
docker exec mei-portal rm /data/shell/user.json
docker restart mei-portal
# 账户回到环境变量/默认值重新初始化
# 注意：账户级数据按 uid 归档，重置后旧 uid 关联的数据（如音乐进度）会失联
```

### Q: 7777 端口被占用 / 想换端口

改 `docker-compose.yml` 的 `ports`，如 `"7788:7777"`，然后 `docker compose up -d`。

### Q: 容器一直 unhealthy

```bash
# healthcheck 打 /healthy（nginx → media core 白名单端点）
curl -fsS http://127.0.0.1:7777/healthy

# 看各进程状态（10 个进程应全部 RUNNING）
docker exec mei-portal supervisorctl status

# 看具体进程日志
docker exec mei-portal supervisorctl tail -2000 stderr <name>
# <name> ∈ nginx/shell/novels/link/tv/draw/music/bgutil/media/disks
```

首次启动 `start_period` 为 90s，期间 healthcheck 失败是正常的（novels 字体下载、依赖初始化都在这窗口内）。

### Q: 某应用 iframe 内空白 / 顶栏不出现

最常见原因：**外网域名经过的中间反向代理剥离了 `Sec-Fetch-Dest` 头**，nginx 无法区分顶级文档与 iframe 请求，document 请求被直接代理到子应用，门户壳不再渲染。

```bash
# 模拟头缺失场景（不传 Sec-Fetch-Dest）：
curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' http://<外网域名>/tv
# 若返回的是子应用内容而非门户壳，说明中间代理层有问题

# 浏览器 F12 看页面标题：应为门户标题而非子应用名称
# 确认 document.getElementById('mei-shell-slot') 不为 null
```

判别规则与 fallback 机制见 `AGENTS.md`「nginx 路由分发」节。**本地验证通过不等于部署达标**——基于请求头的路由判断必须用外网域名验证。

### Q: novels（小说阅读）首次启动很慢

首启会后台下载约 100MB 中文字体到 `/data/novels/fonts/`，需要外网访问。下载在后台进行不阻塞启动；失败时可预先在能联网的机器下载后挂载到该目录。仅首次下载，后续重启秒启。

### Q: 主题不生效 / 应用界面没变成暗色

```bash
# 1. 确认顶栏脚本被注入：浏览器 F12 看 HTML <head> 是否有
#    <script src="/__shell/topbar.js" data-app="..."></script>

# 2. 确认 tokens.css 能 200 加载（Network 面板）
curl -I http://127.0.0.1:7777/__shell/tokens.css

# 3. 改过 plugins/<id>/theme.css 或 tokens.css 后，必须重新构建镜像
npm run build:theme          # 先在宿主机验证聚合产物
docker compose up -d --build # 单镜像：主题资产打进镜像，无独立服务可单独重启

# 4. 浏览器硬刷新该应用 iframe（顶栏刷新按钮或 Ctrl+Shift+R）
```

协调 CSS 的写法与各应用难度参考见 `docs/theming.md`。

### Q: 主题切换后 iframe 内没变化

主题切换经 `postMessage` 广播给各 iframe，加载器只接受来自门户 origin 的消息。

```js
// 在 iframe 内 F12 控制台执行，确认加载器已加载
window.__meiThemeLoader  // 应为 true
```

### Q: 健康徽标一直显示离线

`/api/health` 由 Shell 并发探活各应用（运行时清单 `image/plugins.json` 中 endpoint 为同源、healthPath 为子路径）。

```bash
# 确认目标子路径可通（例：影视）
curl -fsS -o /dev/null http://127.0.0.1:7777/tv

# 确认进程正常
docker exec mei-portal supervisorctl status tv
```

应用启动需要时间，首次启动后等 1-2 分钟再看徽标。

### Q: 想单独重启某个应用

```bash
docker exec mei-portal supervisorctl restart <name>
# 或看实时日志
docker exec mei-portal supervisorctl tail -f <name>
```

不需要重启整个容器；nginx/shell 与各应用进程相互独立。

### Q: 数据重置

```bash
docker compose down -v        # 停止并删除卷（⚠️ 会清空全部应用数据）
# 保留卷只重启：docker compose restart
docker compose up -d
```

全部状态都在 `/data`（账户、音乐进度、书架、下载内容、搜索缓存、穿透配置），备份该卷即备份一切。
