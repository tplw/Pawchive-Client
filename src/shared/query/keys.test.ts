import { describe, expect, it } from "vitest";
import { queryKeys } from "./keys";
import { nextOffset, uniqueBy } from "./pagination";

describe("query keys", () => {
  it("preserves the existing cache key shapes", () => {
    expect(queryKeys.downloads()).toEqual(["downloads"]);
    expect(queryKeys.playlistItems()).toEqual(["playlist-items"]);
    expect(queryKeys.playlistItems(7)).toEqual(["playlist-items", 7]);
    expect(queryKeys.postsDiscover()).toEqual(["posts", "discover"]);
    expect(queryKeys.post("patreon", "1", "2")).toEqual([
      "post",
      "patreon",
      "1",
      "2",
    ]);
    expect(queryKeys.creatorPosts("patreon", "1", "cat")).toEqual([
      "creator-posts",
      "patreon",
      "1",
      "cat",
    ]);
    expect(queryKeys.search("cat", "patreon", ["image"], "relevance")).toEqual([
      "search",
      "cat",
      "patreon",
      ["image"],
      "relevance",
    ]);
  });
});

describe("pagination helpers", () => {
  it("uses the existing page-size arithmetic", () => {
    expect(nextOffset({ hasMore: true, offset: 0 }, 50)).toBe(50);
    expect(nextOffset({ hasMore: false, offset: 50 }, 50)).toBeUndefined();
  });

  it("deduplicates by key and keeps the last item", () => {
    const items = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "a", value: 3 },
    ];
    expect(uniqueBy(items, (item) => item.id)).toEqual([
      { id: "a", value: 3 },
      { id: "b", value: 2 },
    ]);
  });
});
