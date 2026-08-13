// 单用户系统：user.json 持久化（用户名+密码哈希），初始化/登录/改密
// 内网单用户场景，scrypt 哈希足够
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const DATA_DIR = process.env.DATA_DIR || '/data';
const USER_FILE = path.join(DATA_DIR, 'shell', 'user.json');
const COOKIE_NAME = 'mei-auth';
const SESSION_MAX_AGE = 30 * 24 * 3600; // 30 天

interface UserRecord {
  username: string;
  salt: string;
  hash: string;
  createdAt: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loadUser(): UserRecord | null {
  try {
    if (!fs.existsSync(USER_FILE)) return null;
    return JSON.parse(fs.readFileSync(USER_FILE, 'utf8')) as UserRecord;
  } catch {
    return null;
  }
}

function saveUser(u: UserRecord): void {
  fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
  fs.writeFileSync(USER_FILE, JSON.stringify(u, null, 2));
}

/** 首次初始化：用环境变量凭据创建用户（已存在则跳过） */
export function initUserIfNeeded(): void {
  if (loadUser()) return;
  const username = process.env.MEI_ADMIN_USER || 'admin';
  const password = process.env.MEI_ADMIN_PASSWORD || 'mei-allin';
  const salt = crypto.randomBytes(16).toString('hex');
  saveUser({
    username,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  });
}

export function verifyLogin(username: string, password: string): boolean {
  const u = loadUser();
  if (!u || u.username !== username) return false;
  return hashPassword(password, u.salt) === u.hash;
}

export function changePassword(oldPassword: string, newPassword: string): boolean {
  const u = loadUser();
  if (!u) return false;
  if (hashPassword(oldPassword, u.salt) !== u.hash) return false;
  const salt = crypto.randomBytes(16).toString('hex');
  saveUser({ ...u, salt, hash: hashPassword(newPassword, salt) });
  return true;
}

function sessionToken(u: UserRecord): string {
  return crypto.createHash('sha256').update(u.username + ':' + u.hash).digest('hex');
}

export function isLoggedIn(): boolean {
  const c = cookies().get(COOKIE_NAME)?.value;
  if (!c) return false;
  const u = loadUser();
  if (!u) return false;
  return c === sessionToken(u);
}

export function setSession(): string {
  const u = loadUser()!;
  const token = sessionToken(u);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  return token;
}

export function clearSession(): void {
  cookies().delete(COOKIE_NAME);
}

export function getUsername(): string | null {
  return loadUser()?.username || null;
}

export function isInitialized(): boolean {
  return loadUser() !== null;
}

// ---- Token 类应用的凭证存储（sun-panel 等用 token header + localStorage）----
const TOKENS_FILE = path.join(DATA_DIR, 'shell', 'app-tokens.json');

export function setSessionTokens(tokens: Record<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch {}
}

export function getSessionTokens(): Record<string, string> {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
