const prefetchedImages = new Set<string>();

/** Mark a full image as loaded and ready for the viewer's image element. */
export function markImagePrefetched(url: string): void {
  prefetchedImages.add(url);
}

export function isImagePrefetched(url: string): boolean {
  return prefetchedImages.has(url);
}

/** Used by tests; the set only holds URL strings for the session. */
export function clearImagePrefetchCache(): void {
  prefetchedImages.clear();
}
