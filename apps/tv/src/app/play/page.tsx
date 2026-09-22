// 播放页路由入口（查询串形态：/play?source=&id=&title=...）。
// 实现在 ./play-client（见该文件头部说明：页面模块只允许默认导出）。

import { Suspense } from 'react';

import { PlayPageClient } from './play-client';

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
