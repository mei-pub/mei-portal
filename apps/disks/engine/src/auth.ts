// 认证 —— Go api/auth_handler.go + middleware 的精简复刻（HS256 JWT，AUTH_ENABLED=false 时全放行）

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: object, expiresInSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  );
  const sig = createHmac('sha256', config.authJWTSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function issueToken(username: string): string {
  return sign({ sub: username }, config.authTokenExpiryHours * 3600);
}

/** 校验 Bearer token，返回用户名或 null */
export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', config.authJWTSecret).update(`${parts[0]}.${parts[1]}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub: string; exp: number };
    // exp 缺失/非数值时 NaN < now 恒为 false，会被误判为有效，必须显式拒绝
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// ── 已吊销 token 黑名单（登出吊销；内存 Map + 过期清理） ──
// 无状态 JWT 本身无法吊销，登出时把该 token 记入黑名单直到其自然过期
const revokedTokens = new Map<string, number>();
const REVOKED_MAX = 10_000;

function readTokenExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** 登出吊销：token 记入黑名单至其 exp（解析不出 exp 时按 1 小时保守处理） */
export function revokeToken(token: string): void {
  const now = Date.now();
  const until = readTokenExp(token) || now + 3600_000;
  // 插入时顺带清理过期项，防止 Map 无限膨胀
  for (const [t, e] of revokedTokens) {
    if (e < now) revokedTokens.delete(t);
  }
  if (revokedTokens.size >= REVOKED_MAX) {
    const oldest = revokedTokens.keys().next().value;
    if (oldest !== undefined) revokedTokens.delete(oldest);
  }
  revokedTokens.set(token, until);
}

export function isTokenRevoked(token: string): boolean {
  const until = revokedTokens.get(token);
  if (until === undefined) return false;
  if (until < Date.now()) {
    revokedTokens.delete(token);
    return false;
  }
  return true;
}

/** 从 Authorization 头提取用户名（AUTH_ENABLED=false 时放行，返回固定用户） */
export function authenticate(authorization: string | undefined): string | null {
  if (!config.authEnabled) return 'anonymous';
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  if (isTokenRevoked(token)) return null;
  return verifyToken(token);
}

export function checkCredentials(username: string, password: string): boolean {
  return config.authUsers[username] === password;
}
