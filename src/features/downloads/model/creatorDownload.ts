import { api } from "../../../shared/api";
import type { MediaKind, PostPage, PostSummary } from "../../../shared/types";

export type CreatorDownloadOrder = "newest" | "oldest";

export interface CreatorDownloadFilters {
  /** YYYY-MM-DD, local time. Empty means no lower bound. */
  fromDate: string;
  /** YYYY-MM-DD, local time. Empty means no upper bound. */
  toDate: string;
  maxPosts: number;
  keywords: string[];
  mediaKinds: MediaKind[];
  skipUnavailable: boolean;
  skipExisting: boolean;
  order: CreatorDownloadOrder;
}

export interface CreatorDownloadScanResult {
  posts: PostSummary[];
  scanned: number;
  truncated: boolean;
}

export type CreatorPostFetcher = (params: {
  service: string;
  creatorId: string;
  offset: number;
  signal?: AbortSignal;
}) => Promise<PostPage>;

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_SCANNED = 1000;

/** Split comma or newline separated blacklist words into lowercase terms. */
export function parseBlacklistKeywords(value: string): string[] {
  const words = value
    .split(/[\n,]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(words)];
}

export function dateRangeBounds(
  fromDate: string,
  toDate: string,
): { from: number | null; to: number | null } {
  const parse = (value: string, endOfDay: boolean): number | null => {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
    const time = date.getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : null;
  };
  return {
    from: parse(fromDate, false),
    to: parse(toDate, true),
  };
}

export function postMatchesCreatorDownload(
  post: PostSummary,
  filters: CreatorDownloadFilters,
): boolean {
  if (post.attachmentCount === 0) return false;
  if (filters.skipUnavailable && post.unavailable) return false;
  if (filters.mediaKinds.length === 0) return false;

  const { from, to } = dateRangeBounds(filters.fromDate, filters.toDate);
  if (from !== null || to !== null) {
    const stamp = post.published ?? post.added ?? null;
    if (stamp === null) return false;
    if (from !== null && stamp < from) return false;
    if (to !== null && stamp > to) return false;
  }

  if (filters.keywords.length > 0) {
    const haystack = `${post.title} ${post.excerpt}`.toLowerCase();
    if (filters.keywords.some((keyword) => haystack.includes(keyword))) {
      return false;
    }
  }

  const kinds = post.mediaKinds ?? [];
  // Older summaries may not have media kinds yet. Keep the post so the
  // backend can inspect its attachments and apply the exact kind filter.
  if (kinds.length === 0) return true;
  return kinds.some((kind) => filters.mediaKinds.includes(kind));
}

export function sortCreatorDownloadPosts(
  posts: PostSummary[],
  order: CreatorDownloadOrder,
): PostSummary[] {
  return [...posts].sort((left, right) => {
    const leftTime = left.published ?? left.added ?? 0;
    const rightTime = right.published ?? right.added ?? 0;
    return order === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });
}

/**
 * Walk the creator feed until the requested number of matching posts is
 * reached. Only summaries are fetched; attachment kinds are checked again by
 * the backend when the batch starts.
 */
export async function scanCreatorDownloadPosts({
  service,
  creatorId,
  filters,
  signal,
  onProgress,
  fetchPage = api.getCreatorDownloadPosts,
  pageSize = DEFAULT_PAGE_SIZE,
  maxScanned = DEFAULT_MAX_SCANNED,
}: {
  service: string;
  creatorId: string;
  filters: CreatorDownloadFilters;
  signal?: AbortSignal;
  onProgress?: (scanned: number, matched: number) => void;
  fetchPage?: CreatorPostFetcher;
  pageSize?: number;
  maxScanned?: number;
}): Promise<CreatorDownloadScanResult> {
  const limit = Math.max(1, Math.floor(filters.maxPosts));
  const matched: PostSummary[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let scanned = 0;
  let truncated = false;

  for (;;) {
    const page = await fetchPage({ service, creatorId, offset, signal });
    for (let index = 0; index < page.items.length; index += 1) {
      const post = page.items[index];
      const key = `${post.service}:${post.user}:${post.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanned += 1;
      if (!postMatchesCreatorDownload(post, filters)) continue;
      matched.push(post);
      if (matched.length >= limit) {
        truncated = true;
        break;
      }
    }
    onProgress?.(scanned, matched.length);
    if (
      matched.length >= limit ||
      !page.hasMore ||
      scanned >= maxScanned ||
      page.items.length === 0
    ) {
      if (scanned >= maxScanned && matched.length < limit) truncated = true;
      break;
    }
    offset = page.offset + pageSize;
  }

  return {
    posts: sortCreatorDownloadPosts(matched, filters.order),
    scanned,
    truncated,
  };
}
