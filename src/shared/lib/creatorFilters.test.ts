import { describe, expect, it } from "vitest";
import type { PostSummary } from "../types";
import {
  applyMediaFilterToCreators,
  creatorFilterActive,
  autoComicModeForCreator,
  detectAsmrCreator,
  firstImageOnlyForCreator,
  loadCreatorFilter,
  parseFilterKeywords,
  postMatchesCreatorFilter,
  saveCreatorFilter,
  setGlobalMediaFilterDefault,
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
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
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
        mediaFilter: "all" as const,
        hideUnavailable: false,
        overrideGlobalKeywords: false,
        keywords: [],
      }),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 0, mediaKinds: [] }), {
        audioOnly: false,
        mediaFilter: "filesAndPictures" as const,
        hideUnavailable: false,
        overrideGlobalKeywords: false,
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
        {
          audioOnly: false,
          mediaFilter: "filesAndPictures" as const,
          hideUnavailable: false,
          overrideGlobalKeywords: false,
          keywords: [],
        },
      ),
    ).toBe(false);
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
      mediaFilter: "all" as const,
      hideUnavailable: true,
      overrideGlobalKeywords: false,
      keywords: [],
    };
    expect(
      postMatchesCreatorFilter(post({ unavailable: true }), filter),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ unavailable: false }), filter),
    ).toBe(true);
  });

  it("allows a creator to override global keywords", () => {
    const filter = {
      audioOnly: false,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    };
    const spoiler = post({ title: "A spoiler post" });
    expect(postMatchesCreatorFilter(spoiler, filter, ["spoiler"])).toBe(false);
    expect(
      postMatchesCreatorFilter(
        spoiler,
        { ...filter, overrideGlobalKeywords: true },
        ["spoiler"],
      ),
    ).toBe(true);
  });

  it("deduplicates and trims keywords", () => {
    expect(parseFilterKeywords(" sketch, Sketch\ncommission, ")).toEqual([
      "sketch",
      "commission",
    ]);
  });
});

describe("global media filter setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setGlobalMediaFilterDefault("all");
  });

  it("defaults creators without a saved filter to the global value", () => {
    setGlobalMediaFilterDefault("filesAndPictures");
    expect(loadCreatorFilter("patreon", "1").mediaFilter).toBe(
      "filesAndPictures",
    );
  });

  it("applies the global filter to every saved creator filter", () => {
    saveCreatorFilter("patreon", "1", {
      audioOnly: false,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: ["sketch"],
    });
    saveCreatorFilter("patreon", "2", {
      audioOnly: true,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    });

    applyMediaFilterToCreators("filesOnly");

    expect(loadCreatorFilter("patreon", "1")).toMatchObject({
      mediaFilter: "filesOnly" as const,
      keywords: ["sketch"],
    });
    expect(loadCreatorFilter("patreon", "2")).toMatchObject({
      mediaFilter: "filesOnly" as const,
      audioOnly: true,
    });
    expect(loadCreatorFilter("patreon", "3").mediaFilter).toBe("filesOnly");
  });

  it("persists an explicit per-creator override after the global filter", () => {
    applyMediaFilterToCreators("filesOnly");
    saveCreatorFilter("patreon", "1", {
      audioOnly: false,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    });
    expect(loadCreatorFilter("patreon", "1").mediaFilter).toBe("all");

    applyMediaFilterToCreators("all");
    expect(loadCreatorFilter("patreon", "1").mediaFilter).toBe("all");
  });

  it("persists a comic first-image override", () => {
    const base = {
      audioOnly: false,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    };
    window.localStorage.removeItem("pawchive-creator-filter:patreon:comic");

    expect(firstImageOnlyForCreator("patreon", "comic", true)).toBe(true);
    expect(firstImageOnlyForCreator("patreon", "comic", false)).toBe(false);

    saveCreatorFilter("patreon", "comic", { ...base, firstImageOnly: false });
    expect(loadCreatorFilter("patreon", "comic").firstImageOnly).toBe(false);
    expect(creatorFilterActive({ ...base, firstImageOnly: false })).toBe(true);
    expect(firstImageOnlyForCreator("patreon", "comic", true)).toBe(false);

    saveCreatorFilter("patreon", "comic", { ...base, firstImageOnly: true });
    expect(firstImageOnlyForCreator("patreon", "comic", false)).toBe(true);
  });

  it("persists an auto-comic override", () => {
    const base = {
      audioOnly: false,
      mediaFilter: "all" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    };
    window.localStorage.removeItem("pawchive-creator-filter:patreon:autoComic");

    expect(autoComicModeForCreator("patreon", "autoComic", true)).toBe(true);
    expect(autoComicModeForCreator("patreon", "autoComic", false)).toBe(false);

    saveCreatorFilter("patreon", "autoComic", {
      ...base,
      autoComicMode: false,
    });
    expect(loadCreatorFilter("patreon", "autoComic").autoComicMode).toBe(false);
    expect(creatorFilterActive({ ...base, autoComicMode: false })).toBe(true);
    expect(autoComicModeForCreator("patreon", "autoComic", true)).toBe(false);

    saveCreatorFilter("patreon", "autoComic", {
      ...base,
      autoComicMode: true,
    });
    expect(autoComicModeForCreator("patreon", "autoComic", false)).toBe(true);
  });

  it("matches files-and-pictures and files-only modes", () => {
    const filesAndPictures = {
      audioOnly: false,
      mediaFilter: "filesAndPictures" as const,
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    };
    const filesOnly = { ...filesAndPictures, mediaFilter: "filesOnly" as const };
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 0, mediaKinds: [] }), filesAndPictures),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 1, mediaKinds: ["image"] }), filesAndPictures),
    ).toBe(true);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 1, mediaKinds: ["image"] }), filesOnly),
    ).toBe(false);
    expect(
      postMatchesCreatorFilter(post({ attachmentCount: 1, mediaKinds: ["video"] }), filesOnly),
    ).toBe(true);
  });
});
