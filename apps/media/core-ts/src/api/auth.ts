// api/auth —— Go internal/api/middleware/auth.go 的复刻（mei-portal 统一身份）
//
// mediago 不再有独立账户体系（setup/signin 已移除，返回 404）。
// 鉴权 = 校验门户会话令牌：sha256(`${username}:${hash}`)，其中 username/hash 来自
// 门户主应用的 /data/shell/user.json（单镜像同文件系统），带 30s 缓存。
// 门户改密后令牌立即轮换，所有子应用会话同步失效。
// 令牌可经 mei-auth cookie、Authorization Bearer、X-API-Key 三通道携带。

import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { logger } from '../logger.ts';

// 本机验证可用 MEI_SHELL_USER_FILE 覆盖（生产默认与 Go 版一致：/data/shell/user.json）
const SHELL_USER_FILE = process.env.MEI_SHELL_USER_FILE || '/data/shell/user.json';

let cachedToken = '';
let cachedTokenExpires = 0;

/** 计算门户会话令牌（30s 缓存；读取失败缓存 5s 空值） */
export function portalSessionToken(): string {
  const now = Date.now();
  if (now < cachedTokenExpires) return cachedToken;
  try {
    const raw = fs.readFileSync(SHELL_USER_FILE, 'utf8');
    const user = JSON.parse(raw) as { username?: string; hash?: string };
    if (!user.username || !user.hash) {
      cachedToken = '';
      cachedTokenExpires = now + 5_000;
      return '';
    }
    cachedToken = crypto
      .createHash('sha256')
      .update(`${user.username}:${user.hash}`)
      .digest('hex');
    cachedTokenExpires = now + 30_000;
  } catch {
    cachedToken = '';
    cachedTokenExpires = now + 5_000;
  }
  return cachedToken;
}

/** 校验请求是否携带有效门户会话（X-API-Key / Bearer / mei-auth cookie 三通道） */
export function isPortalSession(req: IncomingMessage): boolean {
  const expected = portalSessionToken();
  if (!expected) return false;

  const headers = req.headers;
  const apiKey = headerValue(headers['x-api-key']);
  if (apiKey === expected) return true;

  const auth = headerValue(headers.authorization);
  if (auth.startsWith('Bearer ') && auth.slice('Bearer '.length) === expected) return true;

  const cookie = headerValue(headers.cookie);
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('mei-auth=') && trimmed.slice('mei-auth='.length) === expected) {
      return true;
    }
  }
  return false;
}

function headerValue(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/** 与 Go AuthMiddleware 一致的白名单（setup/signin 已移除但保留白名单项无害） */
const WHITELIST = new Set([
  '/healthy',
  '/api/auth/setup',
  '/api/auth/signin',
  '/api/auth/status',
  '/favicon.ico',
  '/',
]);

/** 请求是否免鉴权（白名单 / 前缀 / SPA 前端路由） */
export function isWhitelisted(pathname: string): boolean {
  if (WHITELIST.has(pathname)) return true;
  if (
    pathname.startsWith('/swagger/') ||
    pathname.startsWith('/player') ||
    pathname.startsWith('/api/v1/') ||
    pathname.startsWith('/videos/') ||
    pathname.startsWith('/assets/')
  ) {
    return true;
  }
  // SPA 前端路由：非 /api/ 且不含 "." 的路径视为客户端路由
  if (!pathname.startsWith('/api/') && !pathname.includes('.')) return true;
  return false;
}

/** 鉴权中间件：未通过 → 返回 false，调用方写 401（pathname 为已解码路径，与 Go URL.Path 一致） */
export function checkAuth(req: IncomingMessage, pathname: string): boolean {
  if (isWhitelisted(pathname)) return true;
  if (isPortalSession(req)) return true;
  logger.warn(`Auth: missing or invalid portal session path=${pathname}`);
  return false;
}
