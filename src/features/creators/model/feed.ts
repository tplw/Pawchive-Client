import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { uniqueBy } from "../../../shared/query/pagination";
import type { BlockedCreator, CreatorSummary } from "../../../shared/types";

/** Filter blocked creators and deduplicate by service and creator id. */
export function visibleCreators(
  creators: Iterable<CreatorSummary>,
  blocked: BlockedCreator[] | null | undefined,
): CreatorSummary[] {
  return uniqueBy(
    [...creators].filter(
      (creator) => !isCreatorBlocked(blocked, creator.service, creator.id),
    ),
    (creator) => `${creator.service}:${creator.id}`,
  );
}
