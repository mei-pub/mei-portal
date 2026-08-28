import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import AppFrame from '@/components/AppFrame';

// 应用承载页：所有子应用都在这里以 iframe 呈现，外壳页面（含音乐播放引擎）不卸载
export const dynamic = 'force-dynamic';

export default function AppHostPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }
  return (
    <Suspense fallback={null}>
      <AppFrame />
    </Suspense>
  );
}
