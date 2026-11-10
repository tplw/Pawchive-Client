import type { PostSummary } from "../../../shared/types";

interface PostFeed {
  visible: PostSummary[];
  allIds: Set<string>;
  hasMore: boolean;
}

const feeds = new Map<string, PostFeed>();

function feedKey(service: string, creatorId: string): string {
  return `${service}:${creatorId}`;
}

/** Remember the currently filtered creator feed for post-to-post navigation. */
export function rememberPostFeed({
  service,
  creatorId,
  visible,
  all,
  hasMore,
}: {
  service: string;
  creatorId: string;
  visible: PostSummary[];
  all: PostSummary[];
  hasMore: boolean;
}): void {
  feeds.set(feedKey(service, creatorId), {
    visible,
    allIds: new Set(all.map((post) => post.id)),
    hasMore,
  });
}

/** Used by tests and when a creator feed is no longer relevant. */
export function clearPostFeeds(): void {
  feeds.clear();
}

/**
 * Return the next/previous post inside the filtered creator feed. When the
 * current post is not in the feed, or the filtered feed ends before the raw
 * archive neighbor, fall back to the archive neighbor only when it is not a
 * known hidden post.
 */
export function neighborForPost({
  service,
  creatorId,
  postId,
  direction,
  fallbackId,
}: {
  service: string;
  creatorId: string;
  postId: string;
  direction: -1 | 1;
  fallbackId: string | null;
}): string | null {
  const feed = feeds.get(feedKey(service, creatorId));
  if (!feed) return fallbackId;
  const index = feed.visible.findIndex((post) => post.id === postId);
  if (index < 0) return fallbackId;

  const visibleNeighbor = feed.visible[index + direction]?.id ?? null;
  if (visibleNeighbor) return visibleNeighbor;
  if (!fallbackId) return null;

  // A raw neighbor that exists in the unfiltered creator page but not in the
  // visible list was hidden by a creator filter.
  if (feed.allIds.has(fallbackId)) return null;

  // If more pages exist, the raw neighbor may be a valid post beyond the
  // loaded page. Once the full feed is loaded, an unknown id is not safe.
  return feed.hasMore ? fallbackId : null;
}
