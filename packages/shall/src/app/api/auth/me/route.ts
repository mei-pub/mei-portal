import { NextResponse } from 'next/server';
import { isLoggedIn, getUsername, isInitialized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    initialized: isInitialized(),
    loggedIn: isLoggedIn(),
    username: isLoggedIn() ? getUsername() : null,
  });
}
