import type { AppSettings, MediaFilter, PostSummary } from "../types";

export interface CreatorFilter {
  audioOnly: boolean;
  mediaFilter: MediaFilter;
  hideUnavailable: boolean;
  overrideGlobalKeywords: boolean;
  keywords: string[];
  /** undefined = auto-detect, true = manually tagged, false = manually rejected. */
  asmr?: boolean;
}

const EMPTY_FILTER: CreatorFilter = {
  audioOnly: false,
  mediaFilter: "all",
  hideUnavailable: false,
  overrideGlobalKeywords: false,
  keywords: [],
};

const FILTER_PREFIX = "pawchive-creator-filter:";

/**
 * The main Settings media filter acts as the default for creators that have
 * not customized their filter. It is kept in memory and refreshed whenever
 * the persisted app settings load or change.
 */
let globalMediaFilterDefault: MediaFilter = "all";

export function setGlobalMediaFilterDefault(value: MediaFilter): void {
  globalMediaFilterDefault = value;
}

export function getGlobalMediaFilterDefault(): MediaFilter {
  return globalMediaFilterDefault;
}

export function effectiveMediaFilter(
  settings: Pick<AppSettings, "mediaFilter" | "hideNoMedia">,
): MediaFilter {
  if (settings.mediaFilter !== "all") return settings.mediaFilter;
  return settings.hideNoMedia ? "filesAndPictures" : "all";
}

/**
 * Apply the main media filter to every saved creator filter. This
 * intentionally overwrites existing per-creator overrides so the setting is
 * consistent across all creators, then leaves the new value as the default for
 * creators without a saved filter.
 */
export function applyMediaFilterToCreators(value: MediaFilter): void {
  globalMediaFilterDefault = value;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(FILTER_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<CreatorFilter> & {
          hideNoMedia?: unknown;
        };
        const next: CreatorFilter = {
          audioOnly: Boolean(parsed.audioOnly),
          mediaFilter: value,
          hideUnavailable: Boolean(parsed.hideUnavailable),
          overrideGlobalKeywords: Boolean(parsed.overrideGlobalKeywords),
          keywords: Array.isArray(parsed.keywords)
            ? parsed.keywords.filter(
                (keyword): keyword is string => typeof keyword === "string",
              )
            : [],
          ...(typeof parsed.asmr === "boolean" ? { asmr: parsed.asmr } : {}),
        };
        if (filterHasStoredRules(next)) {
          window.localStorage.setItem(key, JSON.stringify(next));
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        // Ignore malformed entries; they will be replaced on the next save.
      }
    }
  } catch {
    // Filters still work for the current session if storage is unavailable.
  }
}

function filterHasStoredRules(filter: CreatorFilter): boolean {
  return (
    filter.audioOnly ||
    filter.mediaFilter !== globalMediaFilterDefault ||
    filter.hideUnavailable ||
    filter.overrideGlobalKeywords ||
    filter.keywords.length > 0 ||
    typeof filter.asmr === "boolean"
  );
}

function storageKey(service: string, creatorId: string): string {
  return `${FILTER_PREFIX}${service}:${creatorId}`;
}

export function loadCreatorFilter(
  service: string,
  creatorId: string,
): CreatorFilter {
  try {
    const raw = window.localStorage.getItem(storageKey(service, creatorId));
    if (!raw) {
      return { ...EMPTY_FILTER, mediaFilter: globalMediaFilterDefault };
    }
    const parsed = JSON.parse(raw) as Partial<CreatorFilter> & {
      hideNoMedia?: unknown;
    };
    const mediaFilter: MediaFilter =
      parsed.mediaFilter === "filesAndPictures" ||
      parsed.mediaFilter === "filesOnly" ||
      parsed.mediaFilter === "all"
        ? parsed.mediaFilter
        : parsed.hideNoMedia === true
          ? "filesAndPictures"
          : globalMediaFilterDefault;
    return {
      audioOnly: Boolean(parsed.audioOnly),
      mediaFilter,
      hideUnavailable: Boolean(parsed.hideUnavailable),
      overrideGlobalKeywords: Boolean(parsed.overrideGlobalKeywords),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [],
      ...(typeof parsed.asmr === "boolean" ? { asmr: parsed.asmr } : {}),
    };
  } catch {
    return { ...EMPTY_FILTER, mediaFilter: globalMediaFilterDefault };
  }
}

export function saveCreatorFilter(
  service: string,
  creatorId: string,
  filter: CreatorFilter,
): void {
  try {
    if (filterHasStoredRules(filter)) {
      window.localStorage.setItem(
        storageKey(service, creatorId),
        JSON.stringify(filter),
      );
    } else {
      window.localStorage.removeItem(storageKey(service, creatorId));
    }
  } catch {
    // Filters still work for the current session if storage is unavailable.
  }
}

export function creatorFilterActive(filter: CreatorFilter): boolean {
  return (
    filter.audioOnly ||
    filter.mediaFilter !== "all" ||
    filter.hideUnavailable ||
    filter.overrideGlobalKeywords ||
    filter.keywords.length > 0 ||
    filter.asmr === true
  );
}

export function creatorNameLooksAsmr(name: string): boolean {
  return /\basmr\b/i.test(name);
}

/** Detect ASMR creators from their name, profile text and recent post titles. */
export function detectAsmrCreator(
  name: string,
  description: string | null | undefined,
  posts: PostSummary[],
): boolean {
  const haystack = [
    name,
    description ?? "",
    ...posts
      .slice(0, 40)
      .map((post) => `${post.title} ${post.excerpt}`),
  ]
    .join(" ")
    .toLowerCase();
  return /\basmr\b/.test(haystack) || haystack.includes("a.s.m.r");
}

export function postMatchesCreatorFilter(
  post: PostSummary,
  filter: CreatorFilter,
  globalKeywords: string[] = [],
): boolean {
  if (filter.audioOnly && !post.mediaKinds.includes("audio")) {
    return false;
  }
  if (
    filter.mediaFilter === "filesAndPictures" &&
    post.attachmentCount === 0 &&
    post.mediaKinds.length === 0 &&
    !post.thumbnailUrl
  ) {
    return false;
  }
  if (
    filter.mediaFilter === "filesOnly" &&
    !post.mediaKinds.some((kind) => kind !== "image")
  ) {
    return false;
  }
  if (filter.hideUnavailable && post.unavailable) {
    return false;
  }
  const haystack =
    `${post.title} ${post.excerpt} ${post.creatorName ?? ""}`.toLowerCase();
  if (
    !filter.overrideGlobalKeywords &&
    globalKeywords.some(
      (keyword) =>
        keyword.trim() && haystack.includes(keyword.trim().toLowerCase()),
    )
  ) {
    return false;
  }
  return !filter.keywords.some((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
}

export function parseFilterKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .filter((keyword) => {
      const key = keyword.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}
