import { beforeEach, describe, expect, it } from "vitest";
import type { PostSummary } from "../../../shared/types";
import {
  activeFeedHasMore,
  clearPostFeeds,
  neighborForPost,
  nextPostsInActiveFeed,
  postMayHaveImages,
  rememberActivePostFeed,
  rememberPostFeed,
} from "./postNavigation";

function post(id: string): PostSummary {
  return {
    id,
    service: "patreon",
    user: "creator",
    title: id,
  } as PostSummary;
}

describe("filtered post navigation", () => {
  beforeEach(() => clearPostFeeds());

  it("skips posts hidden by the creator feed", () => {
    rememberPostFeed({
      service: "patreon",
      creatorId: "creator",
      visible: [post("a"), post("c")],
      all: [post("a"), post("b"), post("c")],
      hasMore: false,
    });

    expect(
      neighborForPost({
        service: "patreon",
        creatorId: "creator",
        postId: "a",
        direction: 1,
        fallbackId: "b",
      }),
    ).toBe("c");
  });

  it("does not fall back to a known hidden neighbor", () => {
    rememberPostFeed({
      service: "patreon",
      creatorId: "creator",
      visible: [post("a")],
      all: [post("a"), post("b")],
      hasMore: false,
    });

    expect(
      neighborForPost({
        service: "patreon",
        creatorId: "creator",
        postId: "a",
        direction: 1,
        fallbackId: "b",
      }),
    ).toBeNull();
  });

  it("allows an archive neighbor beyond the loaded page", () => {
    rememberPostFeed({
      service: "patreon",
      creatorId: "creator",
      visible: [post("a")],
      all: [post("a")],
      hasMore: true,
    });

    expect(
      neighborForPost({
        service: "patreon",
        creatorId: "creator",
        postId: "a",
        direction: 1,
        fallbackId: "z",
      }),
    ).toBe("z");
  });

  it("uses the raw neighbor when no filtered feed is available", () => {
    expect(
      neighborForPost({
        service: "patreon",
        creatorId: "creator",
        postId: "a",
        direction: -1,
        fallbackId: "z",
      }),
    ).toBe("z");
  });

  it("returns the visible posts after the current post", () => {
    rememberActivePostFeed([post("a"), post("b"), post("c")], true);

    expect(
      nextPostsInActiveFeed({
        service: "patreon",
        creatorId: "creator",
        postId: "b",
      }).map((entry) => entry.id),
    ).toEqual(["c"]);
    expect(
      nextPostsInActiveFeed({
        service: "patreon",
        creatorId: "creator",
        postId: "missing",
      }),
    ).toEqual([]);
    expect(activeFeedHasMore()).toBe(true);
  });

  it("skips posts that cannot contain images", () => {
    expect(
      postMayHaveImages({
        ...post("a"),
        attachmentCount: 0,
        mediaKinds: [],
      }),
    ).toBe(false);
    expect(
      postMayHaveImages({
        ...post("b"),
        attachmentCount: 2,
        mediaKinds: ["audio"],
      }),
    ).toBe(false);
    expect(
      postMayHaveImages({
        ...post("c"),
        attachmentCount: 2,
        mediaKinds: [],
      }),
    ).toBe(true);
    expect(
      postMayHaveImages({
        ...post("d"),
        attachmentCount: 2,
        mediaKinds: ["image", "audio"],
      }),
    ).toBe(true);
    expect(
      postMayHaveImages({
        ...post("e"),
        attachmentCount: 2,
        mediaKinds: ["image"],
        unavailable: true,
      }),
    ).toBe(false);
  });

  it("treats the filtered creator feed as the active feed", () => {
    rememberPostFeed({
      service: "patreon",
      creatorId: "creator",
      visible: [post("a"), post("c")],
      all: [post("a"), post("b"), post("c")],
      hasMore: false,
    });

    expect(
      nextPostsInActiveFeed({
        service: "patreon",
        creatorId: "creator",
        postId: "a",
      }).map((entry) => entry.id),
    ).toEqual(["c"]);
    expect(activeFeedHasMore()).toBe(false);
  });
});
