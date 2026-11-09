/** Compute the next infinite-query offset while preserving the current rules. */
export function nextOffset(
  page: { hasMore: boolean; offset: number },
  pageSize: number,
): number | undefined {
  return page.hasMore ? page.offset + pageSize : undefined;
}

/**
 * Deduplicate items by a stable key. The last occurrence wins, matching the
 * existing page-reducing loops used by the Discover, Search and creator pages.
 */
export function uniqueBy<T>(
  items: Iterable<T>,
  key: (item: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return [...map.values()];
}
