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
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** 从 Authorization 头提取用户名（AUTH_ENABLED=false 时放行，返回固定用户） */
export function authenticate(authorization: string | undefined): string | null {
  if (!config.authEnabled) return 'anonymous';
  if (!authorization?.startsWith('Bearer ')) return null;
  return verifyToken(authorization.slice('Bearer '.length));
}

export function checkCredentials(username: string, password: string): boolean {
  return config.authUsers[username] === password;
}
