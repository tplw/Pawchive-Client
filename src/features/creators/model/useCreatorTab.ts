import { useEffect, useState } from "react";

export type CreatorTab = "posts" | "about" | "announcements" | "similar";

const TABS: CreatorTab[] = ["posts", "about", "announcements", "similar"];
const STORAGE_PREFIX = "pawchive-creator-tab:";

function storageKey(service: string, creatorId: string): string {
  return `${STORAGE_PREFIX}${service}:${creatorId}`;
}

export function loadCreatorTab(
  service: string,
  creatorId: string,
): CreatorTab {
  try {
    const value = window.sessionStorage.getItem(
      storageKey(service, creatorId),
    ) as CreatorTab | null;
    return value && TABS.includes(value) ? value : "posts";
  } catch {
    return "posts";
  }
}

export function saveCreatorTab(
  service: string,
  creatorId: string,
  tab: CreatorTab,
): void {
  try {
    window.sessionStorage.setItem(storageKey(service, creatorId), tab);
  } catch {
    // Session storage can be unavailable in restricted webviews.
  }
}

/** Keep each creator's selected tab across route changes and back navigation. */
export function useCreatorTab(service: string, creatorId: string) {
  const [tab, setTabState] = useState<CreatorTab>(() =>
    loadCreatorTab(service, creatorId),
  );

  useEffect(() => {
    setTabState(loadCreatorTab(service, creatorId));
  }, [service, creatorId]);

  const setTab = (next: CreatorTab) => {
    setTabState(next);
    saveCreatorTab(service, creatorId, next);
  };

  return [tab, setTab] as const;
}
