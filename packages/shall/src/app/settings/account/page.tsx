import { redirect } from 'next/navigation';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';
import SettingsShell from '@/components/SettingsShell';
import AccountClient from './AccountClient';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) redirect('/login');
  return (
    <SettingsShell>
      <AccountClient />
    </SettingsShell>
  );
}
