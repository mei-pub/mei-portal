import { isLoggedIn, isInitialized, initUserIfNeeded } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  initUserIfNeeded();
  if (isLoggedIn()) redirect('/');
  void isInitialized;
  return <LoginClient />;
}

export const metadata = { title: '登录 · mei-allin' };
