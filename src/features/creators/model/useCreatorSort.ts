import { useEffect, useState } from "react";
import type { CreatorPostSort } from "../../../shared/types";

const SORTS: CreatorPostSort[] = ["newest", "oldest"];
const STORAGE_PREFIX = "pawchive-creator-sort:";

function storageKey(service: string, creatorId: string): string {
  return `${STORAGE_PREFIX}${service}:${creatorId}`;
}

export function loadCreatorSort(
  service: string,
  creatorId: string,
): CreatorPostSort {
  try {
    const value = window.sessionStorage.getItem(
      storageKey(service, creatorId),
    ) as CreatorPostSort | null;
    return value && SORTS.includes(value) ? value : "newest";
  } catch {
    return "newest";
  }
}

export function saveCreatorSort(
  service: string,
  creatorId: string,
  sort: CreatorPostSort,
): void {
  try {
    window.sessionStorage.setItem(storageKey(service, creatorId), sort);
  } catch {
    // Session storage can be unavailable in restricted webviews.
  }
}

/** Keep each creator's post sort across route changes and back navigation. */
export function useCreatorSort(service: string, creatorId: string) {
  const [sort, setSortState] = useState<CreatorPostSort>(() =>
    loadCreatorSort(service, creatorId),
  );

  useEffect(() => {
    setSortState(loadCreatorSort(service, creatorId));
  }, [service, creatorId]);

  const setSort = (next: CreatorPostSort) => {
    setSortState(next);
    saveCreatorSort(service, creatorId, next);
  };

  return [sort, setSort] as const;
}
