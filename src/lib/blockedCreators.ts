import type { BlockedCreator } from "../types";

function sameCreator(
  left: Pick<BlockedCreator, "service" | "id">,
  service: string,
  id: string,
): boolean {
  return (
    left.service.toLowerCase() === service.toLowerCase() &&
    left.id.toLowerCase() === id.toLowerCase()
  );
}

export function findBlockedCreator(
  blocked: BlockedCreator[] | null | undefined,
  service: string,
  id: string,
): BlockedCreator | undefined {
  return blocked?.find((creator) => sameCreator(creator, service, id));
}

export function isCreatorBlocked(
  blocked: BlockedCreator[] | null | undefined,
  service: string,
  id: string,
): boolean {
  return Boolean(findBlockedCreator(blocked, service, id));
}

export function addBlockedCreator(
  blocked: BlockedCreator[] | null | undefined,
  creator: BlockedCreator,
): BlockedCreator[] {
  const current = blocked ?? [];
  if (isCreatorBlocked(current, creator.service, creator.id)) return current;
  return [
    ...current,
    {
      service: creator.service,
      id: creator.id,
      name: creator.name.trim() || creator.id,
    },
  ];
}

export function removeBlockedCreator(
  blocked: BlockedCreator[] | null | undefined,
  service: string,
  id: string,
): BlockedCreator[] {
  return (blocked ?? []).filter(
    (creator) => !sameCreator(creator, service, id),
  );
}
