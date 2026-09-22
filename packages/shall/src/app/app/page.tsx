import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import AppFrame from '@/components/AppFrame';
import { initUserIfNeeded, isLoggedIn } from '@/lib/auth';

// 客户端导航承载页：外壳所有「去某应用」的客户端路由都跳这里
// （/app?app=<id>&path=<应用内路径>），AppFrame 从查询参数解析目标应用。
// 直接整页访问 /app 同样渲染（地址栏随后由 AppFrame 回写为规范应用路径）。
// 旧版把 /app 服务端 redirect 到应用路径，会把客户端路由的 RSC fetch
// 带回应用路径 → 被 nginx Sec-Fetch-Dest 分流打回整页加载，已废弃。
export const dynamic = 'force-dynamic';

export default function AppHostPage() {
  initUserIfNeeded();
  if (!isLoggedIn()) {
    redirect('/login');
  }

  return (
    <Suspense fallback={null}>
      <AppFrame />
    </Suspense>
  );
}
