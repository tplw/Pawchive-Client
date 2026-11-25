import { describe, expect, it, vi } from "vitest";
import type { PostPage, PostSummary } from "../../../shared/types";
import {
  dateRangeBounds,
  parseBlacklistKeywords,
  postMatchesCreatorDownload,
  scanCreatorDownloadPosts,
  sortCreatorDownloadPosts,
  type CreatorDownloadFilters,
} from "./creatorDownload";

const defaults: CreatorDownloadFilters = {
  fromDate: "",
  toDate: "",
  maxPosts: 10,
  keywords: [],
  mediaKinds: ["image"],
  skipUnavailable: true,
  skipExisting: true,
  order: "newest",
};

function post(id: string, overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id,
    service: "patreon",
    user: "creator",
    creatorName: "Ada",
    title: `Post ${id}`,
    excerpt: "",
    published: 1_700_000_000,
    added: 1_700_000_000,
    thumbnailUrl: null,
    attachmentCount: 1,
    mediaKinds: ["image"],
    previewState: null,
    hasFull: null,
    imported: true,
    exceedsLimit: false,
    unavailable: false,
    ...overrides,
  } as PostSummary;
}

describe("creator download filters", () => {
  it("parses comma and newline separated blacklist words", () => {
    expect(parseBlacklistKeywords("spoiler, WIP\nspoiler,  sketch ")).toEqual([
      "spoiler",
      "wip",
      "sketch",
    ]);
  });

  it("matches media kind, date range, blacklist and availability", () => {
    const date = new Date(2026, 0, 15, 12, 0, 0);
    const stamp = Math.floor(date.getTime() / 1000);
    const filters = {
      ...defaults,
      fromDate: "2026-01-15",
      toDate: "2026-01-15",
      keywords: ["spoiler"],
    };

    expect(postMatchesCreatorDownload(post("image", { published: stamp }), filters)).toBe(true);
    expect(
      postMatchesCreatorDownload(
        post("video", { published: stamp, mediaKinds: ["video"] }),
        filters,
      ),
    ).toBe(false);
    expect(
      postMatchesCreatorDownload(
        post("blacklisted", {
          published: stamp,
          title: "A spoiler page",
        }),
        filters,
      ),
    ).toBe(false);
    expect(
      postMatchesCreatorDownload(
        post("unavailable", { published: stamp, unavailable: true }),
        filters,
      ),
    ).toBe(false);
    expect(
      postMatchesCreatorDownload(
        post("old", { published: stamp - 3 * 86400 }),
        filters,
      ),
    ).toBe(false);
    expect(
      postMatchesCreatorDownload(post("empty", { attachmentCount: 0 }), filters),
    ).toBe(false);
  });

  it("computes local start and end of day bounds", () => {
    const bounds = dateRangeBounds("2026-01-15", "2026-01-16");
    expect(bounds.from).toBe(
      Math.floor(new Date(2026, 0, 15, 0, 0, 0).getTime() / 1000),
    );
    expect(bounds.to).toBe(
      Math.floor(new Date(2026, 0, 16, 23, 59, 59).getTime() / 1000),
    );
  });

  it("sorts by post date", () => {
    const older = post("older", { published: 100 });
    const newer = post("newer", { published: 300 });
    expect(sortCreatorDownloadPosts([older, newer], "oldest").map((p) => p.id)).toEqual([
      "older",
      "newer",
    ]);
    expect(sortCreatorDownloadPosts([older, newer], "newest").map((p) => p.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("creator download scan", () => {
  it("stops at the maximum, skips duplicates and reports truncation", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [post("a"), post("b", { mediaKinds: ["video"] })],
        offset: 0,
        hasMore: true,
      } satisfies PostPage)
      .mockResolvedValueOnce({
        items: [post("a"), post("c")],
        offset: 50,
        hasMore: false,
      } satisfies PostPage);

    const result = await scanCreatorDownloadPosts({
      service: "patreon",
      creatorId: "creator",
      filters: { ...defaults, maxPosts: 2 },
      fetchPage,
    });

    expect(result.posts.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(result.scanned).toBe(3);
    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      service: "patreon",
      creatorId: "creator",
      offset: 0,
      signal: undefined,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      service: "patreon",
      creatorId: "creator",
      offset: 50,
      signal: undefined,
    });
  });

  it("returns all matches when the feed ends", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [post("a"), post("b", { mediaKinds: ["audio"] })],
      offset: 0,
      hasMore: false,
    } satisfies PostPage);

    const result = await scanCreatorDownloadPosts({
      service: "patreon",
      creatorId: "creator",
      filters: defaults,
      fetchPage,
    });

    expect(result.posts.map((entry) => entry.id)).toEqual(["a"]);
    expect(result.scanned).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
