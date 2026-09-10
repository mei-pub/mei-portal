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
  uid?: string;
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
    const user = JSON.parse(fs.readFileSync(USER_FILE, 'utf8')) as UserRecord;
    // 懒迁移：早期版本没有稳定 uid，账户级数据只能按用户名定位（改名即丢数据）。
    // 补一个一次性生成的 uid 并落盘，之后所有账户级存储都按 uid 归档。
    if (!user.uid) {
      user.uid = crypto.randomBytes(8).toString('hex');
      try {
        saveUser(user);
      } catch {
        // 只读文件系统等异常：本次请求仍可用内存中的 uid
      }
    }
    return user;
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
  const password = process.env.MEI_ADMIN_PASSWORD || 'mei-portal';
  const salt = crypto.randomBytes(16).toString('hex');
  saveUser({
    uid: crypto.randomBytes(8).toString('hex'),
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

/** 主应用会话令牌：统一身份改造后，这是所有子应用唯一接受的鉴权凭据 */
export function getPortalToken(): string {
  const u = loadUser();
  return u ? sessionToken(u) : '';
}

/** 校验一个凭据是否为当前有效的主应用会话令牌（cookie 值或 Bearer 值） */
export function isPortalTokenValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = getPortalToken();
  return !!expected && token === expected;
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

/** 账户稳定标识：账户级数据（音乐状态等）按此归档，改名不迁移数据 */
export function getUserId(): string | null {
  return loadUser()?.uid || null;
}

/** 修改账户名（需旧密码校验；改名后旧会话失效需重新登录） */
export function changeUsername(oldPassword: string, newUsername: string): boolean {
  const u = loadUser();
  if (!u || !newUsername || !/^[a-zA-Z0-9_-]{2,32}$/.test(newUsername)) return false;
  if (hashPassword(oldPassword, u.salt) !== u.hash) return false;
  saveUser({ ...u, username: newUsername });
  return true;
}

export function isInitialized(): boolean {
  return loadUser() !== null;
}

// ---- Token 类应用的凭证存储（mediago/ai-draw 等用 token header + localStorage）----
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
