import { Suspense } from 'react';

import { LivePageGuard } from '../../page';

export default function LivePage({
  params,
}: {
  params: { source: string; id: string };
}) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageGuard pathSource={params.source} pathId={params.id} />
    </Suspense>
  );
}
