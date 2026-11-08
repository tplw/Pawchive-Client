import { describe, expect, it } from "vitest";
import {
  addBlockedCreator,
  findBlockedCreator,
  isCreatorBlocked,
  removeBlockedCreator,
} from "./blockedCreators";

const patreon = { service: "patreon", id: "42", name: "Ada" };

describe("blocked creators", () => {
  it("matches service and id case-insensitively", () => {
    expect(isCreatorBlocked([patreon], "Patreon", "42")).toBe(true);
    expect(isCreatorBlocked([patreon], "patreon", "43")).toBe(false);
    expect(findBlockedCreator([patreon], "patreon", "42")?.name).toBe("Ada");
  });

  it("adds a creator once and keeps the display name", () => {
    const first = addBlockedCreator([], patreon);
    const second = addBlockedCreator(first, {
      service: "patreon",
      id: "42",
      name: "Renamed",
    });
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe("Ada");
    expect(addBlockedCreator([], { service: "patreon", id: "7", name: " " })[0].name).toBe(
      "7",
    );
  });

  it("removes only the requested creator", () => {
    const blocked = [
      patreon,
      { service: "fanbox", id: "7", name: "Kite" },
    ];
    expect(removeBlockedCreator(blocked, "PATREON", "42")).toEqual([
      { service: "fanbox", id: "7", name: "Kite" },
    ]);
  });
});
