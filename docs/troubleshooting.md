# 部署与排障

## 前置要求

- Docker 20.10+ 与 Docker Compose v2
- 宿主机 80 端口可用（或自行改 compose 映射）
- 首次需联网拉取镜像

## 标准部署

```bash
cp .env.example .env
bash scripts/setup-ip.sh      # 自动检测 IP，写入 ROOT_DOMAIN (nip.io)
npm run build                 # 校验清单 + 构建主题资产 + 生成 nginx 配置
docker compose up -d
```

访问 `http://<ROOT_DOMAIN>`（见 `.env`），用 `SHELL_PASSWORD` 登录。

## 自定义域名（不用 nip.io）

1. 编辑 `.env`：`ROOT_DOMAIN=你的域名`
2. 配置 DNS：为根域名和各子域名前缀（panel/draw/media/tv/music/tools/link/novels）添加 A 记录指向宿主机 IP；或配置泛解析 `*.你的域名`
3. 若用 hosts 文件（仅本机测试），需为每个子域名各加一行

## HTTPS（可选）

内网默认 HTTP。如需 HTTPS：

```bash
# 用 mkcert 生成本地信任的证书
brew install mkcert  # macOS; Linux 见 mkcert 官方安装说明
mkcert -install
bash scripts/setup-certs.sh   # 待补充：生成证书到 certs/
```

然后在 `.env` 设 `USE_TLS=true`，compose 会挂载证书并启用 443。

## 常见问题

### Q: 访问门户白屏 / 502

```bash
# 1. 检查容器状态
docker compose ps

# 2. 看 Shell 日志
docker compose logs shall --tail 50

# 3. 看网关日志
docker compose logs gateway --tail 50

# 4. 确认主题资产已构建（public/__theme/tokens.css 必须存在）
ls packages/shall/public/__theme/
# 若缺失，在宿主机运行 npm run build 后重新 docker compose build shall
```

### Q: 某应用 iframe 内显示空白 / 拒绝连接

最常见原因：浏览器拦截跨域 iframe，或网关未剥离安全头。

```bash
# 1. 确认应用容器正常
docker compose logs <service> --tail 50
curl -I http://<prefix>.<ROOT_DOMAIN>/   # 应返回 200，且无 X-Frame-Options 头

# 2. 确认 nginx 配置已重新生成（改过 manifest 后）
npm run gen:nginx
docker compose restart gateway

# 3. 浏览器控制台看具体报错（F12）
#    若是 CSP frame-ancestors，确认 gen-nginx 生成的 server 块含 proxy_hide_header Content-Security-Policy
```

### Q: 应用界面没变成暗色 / 主题不生效

```bash
# 1. 确认 loader 被注入：浏览器打开该应用子域名，F12 看 HTML <head> 是否有
#    <script src=".../loader.js" data-app="..."></script>

# 2. 若无，网关 sub_filter 未生效。检查 gateway/nginx/conf.d/00-apps.conf
#    确认该应用有对应 server 块且含 sub_filter 指令

# 3. 确认协调 CSS 已生成
ls packages/shall/public/__theme/<app>.css
# 缺失则 plugins/<app>/manifest.yml 的 theme.has_skin 是否为 true，
# 且 plugins/<app>/theme.css 是否存在，然后 npm run build:theme

# 4. 浏览器 Network 面板确认 tokens.css 和 <app>.css 能 200 加载
```

### Q: 子域名打不开 / DNS 解析失败

```bash
# nip.io 方案：确认 ROOT_DOMAIN 格式正确
# 应为 allin.192-168-1-10.nip.io （IP 用连字符）
nslookup <prefix>.<ROOT_DOMAIN>
# 若失败，检查本机能否访问公网 DNS（nip.io 是公网服务）

# 自建 DNS / hosts 方案：确认每个子域名都有记录
```

### Q: 主题切换后 iframe 内没变化

跨子域 postMessage 受同源策略约束，loader 只接受来自 Shell origin 的消息。

```js
// 在 iframe 内 F12 控制台执行，确认 loader 已加载
window.__meiThemeLoader  // 应为 true

// 确认 loader 推断的 SHELL_ORIGIN 正确
// loader.js 从 <script src> 推断 origin，若子域结构特殊可能推断错误
// 检查注入的 script 标签 src 是否指向 shall
```

### Q: 健康徽标一直显示离线

```bash
# /api/health 从 Shell 容器内访问各应用内部 endpoint（如 http://lunatv:3000）
# 确认：
# 1. 目标容器在 mei-net 网络（compose 已配置）
# 2. endpoint 在 manifest.yml 正确（http://<service>:<port>）
# 3. 应用启动需要时间，首次启动后等 1-2 分钟

docker compose exec shall wget -qO- http://lunatv:3000/ | head
```

### Q: docker compose build shall 失败

Shell 的 Docker 构建依赖主题资产（`public/__theme/*`）已存在于源码树。这些是构建产物，需在宿主机先生成：

```bash
npm run build:theme     # 生成主题资产
docker compose build shall
```

若改动过 `plugins/*/theme.css` 或 `tokens.css`，必须重新 `npm run build:theme` 再 build 镜像。

## 重置

```bash
docker compose down -v        # 停止并删除卷（⚠️ 会清空应用数据）
rm -rf data/                  # 清空本地数据
# 保留 .env，重新 up
docker compose up -d
```
