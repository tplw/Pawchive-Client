import type { PostSummary } from "../types";

export interface CreatorFilter {
  audioOnly: boolean;
  hideNoMedia: boolean;
  keywords: string[];
  /** undefined = auto-detect, true = manually tagged, false = manually rejected. */
  asmr?: boolean;
}

const EMPTY_FILTER: CreatorFilter = {
  audioOnly: false,
  hideNoMedia: false,
  keywords: [],
};

function storageKey(service: string, creatorId: string): string {
  return `pawchive-creator-filter:${service}:${creatorId}`;
}

export function loadCreatorFilter(
  service: string,
  creatorId: string,
): CreatorFilter {
  try {
    const raw = window.localStorage.getItem(storageKey(service, creatorId));
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<CreatorFilter>;
    return {
      audioOnly: Boolean(parsed.audioOnly),
      hideNoMedia: Boolean(parsed.hideNoMedia),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [],
      ...(typeof parsed.asmr === "boolean" ? { asmr: parsed.asmr } : {}),
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function saveCreatorFilter(
  service: string,
  creatorId: string,
  filter: CreatorFilter,
): void {
  try {
    if (
      filter.audioOnly ||
      filter.hideNoMedia ||
      filter.keywords.length > 0 ||
      typeof filter.asmr === "boolean"
    ) {
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
