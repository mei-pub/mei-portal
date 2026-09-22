# 部署指南

本项目使用 Cloudflare 托管，通过 GitHub 连接实现自动部署。

## 架构

- **前端**：Cloudflare Pages（连接 GitHub 自动部署）
- **后端**：Cloudflare Workers（连接 GitHub 自动部署）

## 部署前端（Cloudflare Pages）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 选择 GitHub 仓库 `ai-draw-nexus`
4. 配置构建设置：
   - **Framework preset**：Vite
   - **Build command**：`pnpm run build`
   - **Build output directory**：`dist`
5. 添加环境变量（可选）：
   - `VITE_API_BASE_URL`：Worker 部署后的地址
6. 点击 **Save and Deploy**

## 部署后端（Cloudflare Workers）

1. 进入 **Workers & Pages** → **Create** → **Workers** → **Connect to Git**
2. 选择同一个 GitHub 仓库
3. 配置构建设置：
   - **Root directory**：`worker`
   - **Build command**：`pnpm install && pnpm run build`（如果有）或留空
4. 点击 **Save and Deploy**
5. 部署后进入 Worker → **Settings** → **Variables and Secrets**
6. 添加以下 Secrets：

| 名称 | 说明 |
|------|------|
| `AI_PROVIDER` | `openai` 或 `anthropic` |
| `AI_BASE_URL` | API 地址，如 `https://api.openai.com/v1` |
| `AI_API_KEY` | API 密钥 |
| `AI_MODEL_ID` | 模型 ID，如 `gpt-5` |

## 部署后

- 前端地址：`https://ai-draw-nexus.pages.dev`
- Worker 地址：`https://ai-draw-nexus-worker.<账户>.workers.dev`

获取 Worker 地址后，回到 Pages 项目添加环境变量 `VITE_API_BASE_URL`，重新部署即可。

## 自定义域名（可选）

在各自项目的 **Custom domains** 中添加。
