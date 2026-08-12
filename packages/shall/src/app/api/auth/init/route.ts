import { NextResponse } from 'next/server';
import { initUserIfNeeded, isInitialized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  initUserIfNeeded();
  return NextResponse.json({ ok: true, initialized: isInitialized() });
}
