import { redirect } from 'next/navigation';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';
import HelpCenter from './HelpCenter';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) redirect('/login');
  return <HelpCenter />;
}
