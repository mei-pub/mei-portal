import { Suspense } from 'react';

import { PlayPageClient } from '../../page';

export default function PlayPage({
  params,
}: {
  params: { source: string; id: string };
}) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient pathSource={params.source} pathId={params.id} />
    </Suspense>
  );
}
