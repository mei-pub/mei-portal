import { redirect } from 'next/navigation';
import { isLoggedIn, initUserIfNeeded } from '@/lib/auth';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }
  return <SettingsClient />;
}
