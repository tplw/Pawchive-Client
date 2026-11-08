import { describe, expect, it } from "vitest";
import type { PostSummary } from "../types";
import {
  applyHideNoMediaToCreators,
  creatorFilterActive,
  detectAsmrCreator,
  loadCreatorFilter,
  parseFilterKeywords,
  postMatchesCreatorFilter,
  saveCreatorFilter,
  setGlobalHideNoMediaDefault,
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
    imported: true,
    exceedsLimit: false,
    unavailable: false,
    ...overrides,
  };
}

describe("creator filters", () => {
  it("matches audio-only and keyword rules", () => {
    const filter = {
      audioOnly: true,
      hideNoMedia: false,
      hideUnavailable: false,
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
        hideUnavailable: false,
        keywords: [],
      }),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 0, mediaKinds: [] }), {
        audioOnly: false,
        hideNoMedia: true,
        hideUnavailable: false,
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
        { audioOnly: false, hideNoMedia: true, hideUnavailable: false, keywords: [] },
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

  it("hides unavailable posts when the creator filter asks for it", () => {
    const filter = {
      audioOnly: false,
      hideNoMedia: false,
      hideUnavailable: true,
      keywords: [],
    };
    expect(
      postMatchesCreatorFilter(post({ unavailable: true }), filter),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ unavailable: false }), filter),
    ).toBe(true);
  });

  it("deduplicates and trims keywords", () => {
    expect(parseFilterKeywords(" sketch, Sketch\ncommission, ")).toEqual([
      "sketch",
      "commission",
    ]);
  });
});

describe("global hide-no-media setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setGlobalHideNoMediaDefault(false);
  });

  it("defaults creators without a saved filter to the global value", () => {
    setGlobalHideNoMediaDefault(true);
    expect(loadCreatorFilter("patreon", "1").hideNoMedia).toBe(true);
  });

  it("applies the global toggle to every saved creator filter", () => {
    saveCreatorFilter("patreon", "1", {
      audioOnly: false,
      hideNoMedia: false,
      hideUnavailable: false,
      keywords: ["sketch"],
    });
    saveCreatorFilter("patreon", "2", {
      audioOnly: true,
      hideNoMedia: false,
      hideUnavailable: false,
      keywords: [],
    });

    applyHideNoMediaToCreators(true);

    expect(loadCreatorFilter("patreon", "1")).toMatchObject({
      hideNoMedia: true,
      keywords: ["sketch"],
    });
    expect(loadCreatorFilter("patreon", "2")).toMatchObject({
      hideNoMedia: true,
      audioOnly: true,
    });
    expect(loadCreatorFilter("patreon", "3").hideNoMedia).toBe(true);
  });

  it("persists an explicit per-creator override after the global toggle", () => {
    applyHideNoMediaToCreators(true);
    saveCreatorFilter("patreon", "1", {
      audioOnly: false,
      hideNoMedia: false,
      hideUnavailable: false,
      keywords: [],
    });
    expect(loadCreatorFilter("patreon", "1").hideNoMedia).toBe(false);

    applyHideNoMediaToCreators(false);
    expect(loadCreatorFilter("patreon", "1").hideNoMedia).toBe(false);
  });
});
