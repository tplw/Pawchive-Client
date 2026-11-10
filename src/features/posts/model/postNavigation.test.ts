import { beforeEach, describe, expect, it } from "vitest";
import type { PostSummary } from "../../../shared/types";
import { clearPostFeeds, neighborForPost, rememberPostFeed } from "./postNavigation";

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
});
