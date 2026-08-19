import { redirect } from 'next/navigation';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import HomeEditorClient from './HomeEditorClient';

export const dynamic = 'force-dynamic';

// 主页设置（mei-allin 自研，替代 SunPanel 管理弹层）
export default async function HomeEditorPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }
  return <HomeEditorClient />;
}
