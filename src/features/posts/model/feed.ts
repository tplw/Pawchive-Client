import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { uniqueBy } from "../../../shared/query/pagination";
import type { BlockedCreator, PostSummary } from "../../../shared/types";

/** Filter blocked creators and deduplicate posts by service, creator and id. */
export function visiblePosts(
  posts: Iterable<PostSummary>,
  blocked: BlockedCreator[] | null | undefined,
): PostSummary[] {
  return uniqueBy(
    [...posts].filter(
      (post) => !isCreatorBlocked(blocked, post.service, post.user),
    ),
    (post) => `${post.service}:${post.user}:${post.id}`,
  );
}
