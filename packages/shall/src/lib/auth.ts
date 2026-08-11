// 简单门禁：单一入口密码（环境变量 SHELL_PASSWORD）
// 用 httpOnly cookie 维持登录态。留空密码 = 完全开放。
// 注意：这不是生产级安全方案，仅作为内网门户的入口门禁。

import { cookies } from 'next/headers';

const COOKIE_NAME = 'mei-auth';
// session token 由密码 + 静态盐派生，无需存储
const SALT = 'mei-allin-v1';

function deriveToken(password: string): string {
  // 简单派生（非密码学强度，门禁足够）
  let h = 0;
  const s = password + SALT;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return 't_' + Math.abs(h).toString(36);
}

export function getPassword(): string {
  return process.env.SHELL_PASSWORD || '';
}

export function isAuthOpen(): boolean {
  return getPassword() === '';
}

export function isLoggedIn(): boolean {
  const pw = getPassword();
  if (pw === '') return true; // 开放模式
  const store = cookies();
  const c = store.get(COOKIE_NAME)?.value;
  return c === deriveToken(pw);
}

export function attemptLogin(input: string): boolean {
  const pw = getPassword();
  if (pw === '' || input === pw) {
    cookies().set(COOKIE_NAME, deriveToken(pw), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return true;
  }
  return false;
}

export function logout() {
  cookies().delete(COOKIE_NAME);
}
