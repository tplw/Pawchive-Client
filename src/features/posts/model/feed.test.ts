import { describe, expect, it } from "vitest";
import type { CreatorSummary, PostSummary } from "../../../shared/types";
import { visibleCreators } from "../../creators/model/feed";
import { visiblePosts } from "./feed";

function post(id: string, title: string): PostSummary {
  return {
    id,
    service: "patreon",
    user: "creator",
    title,
  } as PostSummary;
}

function creator(id: string, name: string): CreatorSummary {
  return { id, service: "patreon", name } as CreatorSummary;
}

const blocked = [{ service: "patreon", id: "blocked", name: "Blocked" }];

describe("visible feed helpers", () => {
  it("removes blocked posts and keeps the last duplicate", () => {
    expect(
      visiblePosts(
        [post("1", "first"), post("2", "second"), post("1", "last")],
        blocked,
      ).map((item) => item.title),
    ).toEqual(["last", "second"]);
  });

  it("removes blocked creators and deduplicates by id", () => {
    expect(
      visibleCreators(
        [creator("creator", "One"), creator("blocked", "Blocked"), creator("creator", "Two")],
        blocked,
      ).map((item) => item.name),
    ).toEqual(["Two"]);
  });
});
