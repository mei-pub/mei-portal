import { isAuthOpen, isLoggedIn, attemptLogin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LoginClient from './LoginClient';

export default function LoginPage() {
  // 已开放或已登录 → 跳首页
  if (isAuthOpen() || isLoggedIn()) {
    redirect('/');
  }
  return <LoginClient />;
}

export const metadata = { title: '登录 · mei-allin' };
