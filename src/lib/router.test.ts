import { describe, expect, it } from "vitest";
import { parseRoute, routeToHash, routeTitle } from "./router";

describe("hash router", () => {
  it("parses the home route and unknown routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/home")).toEqual({ name: "home" });
    expect(parseRoute("#/not-a-page")).toEqual({ name: "home" });
  });

  it("parses creator and post routes", () => {
    expect(parseRoute("#/creator/patreon/42")).toEqual({
      name: "creator",
      service: "patreon",
      creatorId: "42",
    });
    expect(parseRoute("#/post/fanbox/7/99")).toEqual({
      name: "post",
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    });
  });

  it("decodes search and creator queries", () => {
    expect(parseRoute("#/search?q=hello%20world")).toEqual({
      name: "search",
      query: "hello world",
    });
    expect(parseRoute("#/creators?q=ada")).toEqual({
      name: "creators",
      query: "ada",
    });
  });

  it("parses playlist routes", () => {
    expect(parseRoute("#/playlist/12")).toEqual({
      name: "playlist",
      playlistId: 12,
    });
    expect(routeToHash({ name: "playlist", playlistId: 12 })).toBe("#/playlist/12");
  });

  it("falls back when route identifiers are incomplete", () => {
    expect(parseRoute("#/creator/patreon")).toEqual({ name: "creators" });
    expect(parseRoute("#/post/patreon/1")).toEqual({ name: "discover" });
  });

  it("serializes routes with encoded components", () => {
    expect(routeToHash({ name: "search", query: "a&b c" })).toBe(
      "#/search?q=a%26b%20c",
    );
    expect(
      routeToHash({ name: "creator", service: "fanbox", creatorId: "12/3" }),
    ).toBe("#/creator/fanbox/12%2F3");
    expect(routeToHash({ name: "creators", query: "ada" })).toBe(
      "#/creators?q=ada",
    );
  });

  it("returns a readable title", () => {
    expect(routeTitle({ name: "search" })).toBe("Search");
    expect(routeTitle({ name: "post" })).toBe("Post");
  });
});
