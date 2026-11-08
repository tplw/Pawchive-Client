import type { PostSummary } from "../types";

export interface CreatorFilter {
  audioOnly: boolean;
  hideNoMedia: boolean;
  hideUnavailable: boolean;
  keywords: string[];
  /** undefined = auto-detect, true = manually tagged, false = manually rejected. */
  asmr?: boolean;
}

const EMPTY_FILTER: CreatorFilter = {
  audioOnly: false,
  hideNoMedia: false,
  hideUnavailable: false,
  keywords: [],
};

const FILTER_PREFIX = "pawchive-creator-filter:";

/**
 * The main Settings toggle acts as the default for creators that have not
 * customized their filter. It is kept in memory and refreshed whenever the
 * persisted app settings load or change.
 */
let globalHideNoMediaDefault = false;

export function setGlobalHideNoMediaDefault(value: boolean): void {
  globalHideNoMediaDefault = value;
}

export function getGlobalHideNoMediaDefault(): boolean {
  return globalHideNoMediaDefault;
}

/**
 * Apply the main "Hide posts without media" toggle to every saved creator
 * filter. This intentionally overwrites existing per-creator overrides so the
 * setting is consistent across all creators, then leaves the new value as the
 * default for creators without a saved filter.
 */
export function applyHideNoMediaToCreators(value: boolean): void {
  globalHideNoMediaDefault = value;
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
        const parsed = JSON.parse(raw) as Partial<CreatorFilter>;
        const next: CreatorFilter = {
          audioOnly: Boolean(parsed.audioOnly),
          hideNoMedia: value,
          hideUnavailable: Boolean(parsed.hideUnavailable),
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
    filter.hideNoMedia !== globalHideNoMediaDefault ||
    filter.hideUnavailable ||
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
      return { ...EMPTY_FILTER, hideNoMedia: globalHideNoMediaDefault };
    }
    const parsed = JSON.parse(raw) as Partial<CreatorFilter>;
    return {
      audioOnly: Boolean(parsed.audioOnly),
      hideNoMedia:
        typeof parsed.hideNoMedia === "boolean"
          ? parsed.hideNoMedia
          : globalHideNoMediaDefault,
      hideUnavailable: Boolean(parsed.hideUnavailable),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [],
      ...(typeof parsed.asmr === "boolean" ? { asmr: parsed.asmr } : {}),
    };
  } catch {
    return { ...EMPTY_FILTER, hideNoMedia: globalHideNoMediaDefault };
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
    filter.hideNoMedia ||
    filter.hideUnavailable ||
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
): boolean {
  if (filter.audioOnly && !post.mediaKinds.includes("audio")) {
    return false;
  }
  if (filter.hideNoMedia && post.attachmentCount === 0) {
    const hasLink = /https?:\/\//i.test(`${post.title} ${post.excerpt}`);
    if (!hasLink) return false;
  }
  if (filter.hideUnavailable && post.unavailable) {
    return false;
  }
  if (filter.keywords.length === 0) return true;
  const haystack = `${post.title} ${post.excerpt} ${post.creatorName ?? ""}`.toLowerCase();
  return !filter.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
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
