import { describe, expect, it } from "vitest";
import type { PostSummary } from "../types";
import {
  creatorFilterActive,
  detectAsmrCreator,
  parseFilterKeywords,
  postMatchesCreatorFilter,
} from "./creatorFilters";

function post(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id: "1",
    service: "patreon",
    user: "1",
    creatorName: "Artist",
    title: "A post",
    excerpt: "",
    published: 0,
    added: 0,
    thumbnailUrl: null,
    attachmentCount: 0,
    mediaKinds: ["image"],
    previewState: null,
    hasFull: true,
    ...overrides,
  };
}

describe("creator filters", () => {
  it("matches audio-only and keyword rules", () => {
    const filter = {
      audioOnly: true,
      hideNoMedia: false,
      keywords: ["sketch"],
    };
    expect(postMatchesCreatorFilter(post(), filter)).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ mediaKinds: ["audio"] }), filter),
    ).toBe(true);
    expect(
      postMatchesCreatorFilter(
        post({ mediaKinds: ["audio"], title: "Rough sketch" }),
        filter,
      ),
    ).toBe(false);
    expect(creatorFilterActive(filter)).toBe(true);
    expect(
      creatorFilterActive({
        audioOnly: false,
        hideNoMedia: false,
        keywords: [],
      }),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 0, mediaKinds: [] }), {
        audioOnly: false,
        hideNoMedia: true,
        keywords: [],
      }),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(
        post({
          attachmentCount: 0,
          mediaKinds: [],
          excerpt: "https://example.com",
        }),
        { audioOnly: false, hideNoMedia: true, keywords: [] },
      ),
    ).toBe(true);
  });

  it("detects ASMR creators from names and post text", () => {
    expect(detectAsmrCreator("ASMR Haven", "", [])).toBe(true);
    expect(
      detectAsmrCreator("Quiet Artist", "", [
        post({ title: "ASMR whisper practice" }),
      ]),
    ).toBe(true);
    expect(detectAsmrCreator("Ai", "", [])).toBe(false);
  });

  it("deduplicates and trims keywords", () => {
    expect(parseFilterKeywords(" sketch, Sketch\ncommission, ")).toEqual([
      "sketch",
      "commission",
    ]);
  });
});
