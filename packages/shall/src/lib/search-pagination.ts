import type { SearchGroup } from './unified-search';

/** Append one provider's page without disturbing any other provider group. */
export function appendSearchGroupPage(previous: SearchGroup, incoming: SearchGroup): SearchGroup {
  const seen = new Set(previous.results.map((result) => result.id));
  const appended = incoming.results.filter((result) => !seen.has(result.id));
  return {
    ...incoming,
    // A fully duplicated page means advancing the cursor makes no progress.
    // Stop the channel instead of letting infinite scroll hammer the provider.
    hasMore: appended.length > 0 && incoming.hasMore,
    total: previous.results.length + appended.length,
    results: [...previous.results, ...appended],
  };
}
