import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import AppFrame from '@/components/AppFrame';
import { isAppPath } from '@/lib/app-routes';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';
import { redirect } from 'next/navigation';

// Top-level application resource paths are rendered by the same persistent shell.
export const dynamic = 'force-dynamic';

export default function AppResourcePage({ params }: { params: { slug: string[] } }) {
  const path = `/${(params.slug || []).join('/')}`;
  if (!isAppPath(path)) notFound();

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
