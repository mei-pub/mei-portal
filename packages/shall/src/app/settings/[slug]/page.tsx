import { notFound, redirect } from 'next/navigation';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';
import SettingsShell from '@/components/SettingsShell';
import AiDrawSettings from '@/components/settings-apps/AiDrawSettings';
import AiDrawStatus from '@/components/settings-apps/AiDrawStatus';
import BackupSettings from '@/components/settings-apps/BackupSettings';
import LinkLogs from '@/components/settings-apps/LinkLogs';
import LinkServerSettings from '@/components/settings-apps/LinkServerSettings';
import MediagoSettings from '@/components/settings-apps/MediagoSettings';
import NovelsManage from '@/components/settings-apps/NovelsManage';
import PansouSettings from '@/components/settings-apps/PansouSettings';
import SolaraSettings from '@/components/settings-apps/SolaraSettings';
import TvCombined from '@/components/settings-apps/TvCombined';

export const dynamic = 'force-dynamic';

const PAGES = {
  'ai-draw': AiDrawSettings,
  'ai-draw-status': AiDrawStatus,
  backup: BackupSettings,
  'link-logs': LinkLogs,
  'link-server': LinkServerSettings,
  mediago: MediagoSettings,
  'novels-manage': NovelsManage,
  pansou: PansouSettings,
  solara: SolaraSettings,
  tv: TvCombined,
} as const;

export default async function SettingsAppPage({ params }: { params: { slug: string } }) {
  initUserIfNeeded();
  if (!isLoggedIn()) redirect('/login');
  const Page = PAGES[params.slug as keyof typeof PAGES];
  if (!Page) notFound();
  return (
    <SettingsShell>
      <Page />
    </SettingsShell>
  );
}
