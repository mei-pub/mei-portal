import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import SearchClient from '@/components/SearchClient';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function SearchPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) redirect('/login');
  return (
    <Suspense fallback={null}>
      <SearchClient />
    </Suspense>
  );
}
