import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../shared/types";
import { ImageViewer } from "./ImageViewer";

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
  afterEach(() => vi.unstubAllGlobals());

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

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(nextPost).toHaveBeenCalledTimes(1);
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
