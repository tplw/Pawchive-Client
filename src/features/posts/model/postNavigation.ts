import type { PostSummary } from "../../../shared/types";

interface PostFeed {
  visible: PostSummary[];
  allIds: Set<string>;
  hasMore: boolean;
}

const feeds = new Map<string, PostFeed>();

interface ActivePostFeed {
  visible: PostSummary[];
  hasMore: boolean;
}

let activeFeed: ActivePostFeed | null = null;

function feedKey(service: string, creatorId: string): string {
  return `${service}:${creatorId}`;
}

/** Remember the visible order of the feed the user is currently browsing. */
export function rememberActivePostFeed(
  visible: PostSummary[],
  hasMore: boolean,
): void {
  activeFeed = { visible, hasMore };
}

/** Posts after the current one in the active visible feed. */
export function nextPostsInActiveFeed({
  service,
  creatorId,
  postId,
}: {
  service: string;
  creatorId: string;
  postId: string;
}): PostSummary[] {
  if (!activeFeed) return [];
  const index = activeFeed.visible.findIndex(
    (post) =>
      post.service === service && post.user === creatorId && post.id === postId,
  );
  if (index < 0) return [];
  return activeFeed.visible.slice(index + 1);
}

/** Whether the active feed has unloaded pages after its visible list. */
export function activeFeedHasMore(): boolean {
  return activeFeed?.hasMore ?? false;
}

/** Cheap pre-check before fetching a post's attachments for comic mode. */
export function postMayHaveImages(post: PostSummary): boolean {
  if (post.unavailable || post.attachmentCount === 0) return false;
  const kinds = post.mediaKinds ?? [];
  return kinds.length === 0 || kinds.includes("image");
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
  rememberActivePostFeed(visible, hasMore);
}

/** Used by tests and when a creator feed is no longer relevant. */
export function clearPostFeeds(): void {
  feeds.clear();
  activeFeed = null;
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
