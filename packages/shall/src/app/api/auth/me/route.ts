import { NextResponse } from 'next/server';
import { isLoggedIn, getUsername, isInitialized, getPortalToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// 统一身份改造：token 类子应用（mediago/ai-draw）的凭据就是主应用会话令牌。
// token-sync 把它写入子应用前端的 localStorage，前端发送的 Bearer/X-API-Key
// 由各应用鉴权模块转发 /api/auth/verify 校验。
export async function GET() {
  const loggedIn = isLoggedIn();
  const portalToken = loggedIn ? getPortalToken() : '';
  return NextResponse.json({
    initialized: isInitialized(),
    loggedIn,
    username: loggedIn ? getUsername() : null,
    tokens: portalToken ? { mediago: portalToken, 'ai-draw': portalToken } : {},
  });
}
