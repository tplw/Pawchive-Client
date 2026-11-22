const prefetchedImages = new Set<string>();
const cachedImages = new Map<string, string>();
const pendingCachedImages = new Map<string, Promise<string>>();

/** Mark a full image as loaded and ready for the viewer's image element. */
export function markImagePrefetched(url: string): void {
  prefetchedImages.add(url);
}

export function isImagePrefetched(url: string): boolean {
  return prefetchedImages.has(url);
}

/** Drop an optimistic prefetch after the image failed to load. */
export function forgetImagePrefetched(url: string): void {
  prefetchedImages.delete(url);
}

/** Record a completed media-cache prefetch and its loopback URL. */
export function markCachedImagePrefetched(
  url: string,
  localUrl: string,
): void {
  cachedImages.set(url, localUrl);
}

export function cachedImagePrefetched(url: string): string | null {
  return cachedImages.get(url) ?? null;
}

export function pendingCachedImagePrefetch(
  url: string,
): Promise<string> | null {
  return pendingCachedImages.get(url) ?? null;
}

/**
 * Track a media-cache download started ahead of time. The viewer reuses the
 * same promise instead of starting a second download when the image opens.
 */
export function trackCachedImagePrefetch(
  url: string,
  promise: Promise<string>,
): void {
  if (cachedImages.has(url) || pendingCachedImages.has(url)) return;
  pendingCachedImages.set(url, promise);
  void promise
    .then((localUrl) => {
      cachedImages.set(url, localUrl);
      pendingCachedImages.delete(url);
    })
    .catch(() => {
      pendingCachedImages.delete(url);
    });
}

/** Used by tests; the maps only hold session state. */
export function clearImagePrefetchCache(): void {
  prefetchedImages.clear();
  cachedImages.clear();
  pendingCachedImages.clear();
}
