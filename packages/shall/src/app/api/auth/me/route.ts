import { NextResponse } from 'next/server';
import { isLoggedIn, getUsername, isInitialized, getSessionTokens } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const loggedIn = isLoggedIn();
  return NextResponse.json({
    initialized: isInitialized(),
    loggedIn,
    username: loggedIn ? getUsername() : null,
    tokens: loggedIn ? getSessionTokens() : {},
  });
}
