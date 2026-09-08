import { notFound, redirect } from 'next/navigation';

import { legacyAppHostPath } from '@/lib/app-routes';

// Legacy host URLs remain shareable, but are replaced with canonical resource paths.
export const dynamic = 'force-dynamic';

export default function LegacyAppHostPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const app = Array.isArray(searchParams?.app) ? searchParams?.app[0] : searchParams?.app;
  const path = Array.isArray(searchParams?.path) ? searchParams?.path[0] : searchParams?.path;
  if (!app || !path) notFound();

  const query = new URLSearchParams({ app, path });
  const target = legacyAppHostPath(`/app?${query.toString()}`);
  if (!target) notFound();
  redirect(target);
}
