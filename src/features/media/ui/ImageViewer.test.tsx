import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import type { Attachment } from "../../../shared/types";
import { clearImagePrefetchCache } from "../model/imagePrefetch";
import { ImageViewer } from "./ImageViewer";

vi.mock("../../../shared/api", () => ({
  api: {
    cacheMedia: vi
      .fn()
      .mockResolvedValue("http://127.0.0.1:1/media/cached.jpg"),
  },
}));

vi.mock("../model/useImageViewerSource", () => ({
  useImageViewerSource: () => ({
    displaySrc: "https://example.com/page.jpg",
    progress: null,
    failed: false,
    handleImageError: vi.fn(),
  }),
}));

function image(name: string): Attachment {
  return {
    name,
    path: `/${name}`,
    url: `https://example.com/${name}`,
    thumbnailUrl: `https://example.com/thumb-${name}`,
    downloadUrl: `https://example.com/${name}`,
    kind: "image",
    provider: "pawchive",
    ext: "jpg",
    previewOnly: false,
  };
}

describe("image viewer comic mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
    clearImagePrefetchCache();
  });

  it("prefetches the next two images when enabled", () => {
    const sources: string[] = [];
    class FakeImage {
      decoding = "";
      set src(value: string) {
        sources.push(value);
      }
    }
    vi.stubGlobal("Image", FakeImage);

    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg"), image("three.jpg")]}
        index={0}
        onIndexChange={() => undefined}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={() => undefined}
        prefetchCount={2}
      />,
    );

    expect(sources).toEqual([
      "https://example.com/two.jpg",
      "https://example.com/three.jpg",
    ]);
  });

  it("prefetches previous images when the reading direction is previous", () => {
    const sources: string[] = [];
    class FakeImage {
      decoding = "";
      set src(value: string) {
        sources.push(value);
      }
    }
    vi.stubGlobal("Image", FakeImage);

    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg"), image("three.jpg")]}
        index={2}
        onIndexChange={() => undefined}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={() => undefined}
        prefetchCount={2}
        prefetchDirection="previous"
      />,
    );

    expect(sources).toEqual([
      "https://example.com/two.jpg",
      "https://example.com/one.jpg",
    ]);
  });

  it("prefetches through the media cache when caching is enabled", () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, cacheMedia: true },
    });

    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg"), image("three.jpg")]}
        index={0}
        onIndexChange={() => undefined}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={() => undefined}
        prefetchCount={2}
      />,
    );

    expect(api.cacheMedia).toHaveBeenCalledWith("https://example.com/two.jpg");
    expect(api.cacheMedia).toHaveBeenCalledWith("https://example.com/three.jpg");
  });

  it("advances to the next post when the last image is reached", () => {
    const nextPost = vi.fn();
    const onIndexChange = vi.fn();
    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg")]}
        index={1}
        onIndexChange={onIndexChange}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={nextPost}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next post" }));

    expect(nextPost).toHaveBeenCalledTimes(1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("moves to the previous post from the first image", () => {
    const previousPost = vi.fn();
    const onIndexChange = vi.fn();
    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg")]}
        index={0}
        onIndexChange={onIndexChange}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={() => undefined}
        onPreviousPost={previousPost}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous post" }));

    expect(previousPost).toHaveBeenCalledTimes(1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("still advances within the current post before loading the next one", () => {
    const nextPost = vi.fn();
    const onIndexChange = vi.fn();
    render(
      <ImageViewer
        images={[image("one.jpg"), image("two.jpg")]}
        index={0}
        onIndexChange={onIndexChange}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={() => undefined}
        onNextPost={nextPost}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(nextPost).not.toHaveBeenCalled();
  });

  it("toggles comic mode from the viewer controls", () => {
    const toggle = vi.fn();
    render(
      <ImageViewer
        images={[image("one.jpg")]}
        index={0}
        onIndexChange={() => undefined}
        onClose={() => undefined}
        comicMode
        onToggleComicMode={toggle}
        onNextPost={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Comic mode on" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
