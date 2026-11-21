import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../shared/types";
import { useImageViewerSource } from "./useImageViewerSource";

const image: Attachment = {
  name: "full.jpeg",
  path: "/24/aa/full.jpeg",
  url: "https://file.pawchive.pw/data/24/aa/full.jpeg",
  thumbnailUrl: "https://img.pawchive.pw/thumbnail/data/4/aa/full.jpeg",
  downloadUrl: "https://file.pawchive.pw/data/24/aa/full.jpeg",
  kind: "image",
  provider: "pawchive",
  ext: "jpeg",
  previewOnly: false,
};

describe("image viewer source", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the thumbnail with the fetched full image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: {
          "content-type": "image/jpeg",
          "content-length": "3",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useImageViewerSource({ image, index: 0, cacheMedia: false }),
    );

    expect(result.current.displaySrc).toBe(image.thumbnailUrl);
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:test"));
    expect(fetchMock).toHaveBeenCalledWith(
      image.url,
      expect.objectContaining({ cache: "force-cache" }),
    );
  });

  it("tries the full URL before falling back to the thumbnail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: {
            "content-type": "image/jpeg",
            "content-length": "3",
          },
        }),
      ),
    );

    const { result } = renderHook(() =>
      useImageViewerSource({ image, index: 0, cacheMedia: false }),
    );
    await waitFor(() => expect(result.current.displaySrc).toBe("blob:test"));

    act(() => result.current.handleImageError());
    expect(result.current.displaySrc).toBe(image.url);

    act(() => result.current.handleImageError());
    expect(result.current.displaySrc).toBe(image.thumbnailUrl);

    act(() => result.current.handleImageError());
    expect(result.current.failed).toBe(true);
  });
});
