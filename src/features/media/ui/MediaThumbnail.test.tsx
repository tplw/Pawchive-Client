import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaThumbnail } from "./MediaThumbnail";

describe("media thumbnail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an image that is already cached", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );

    const { container } = render(
      <MediaThumbnail
        kind="image"
        thumbnailUrl="https://img.pawchive.pw/thumbnail/data/aa/bb/image.jpg"
        mediaUrl="https://file.pawchive.pw/data/aa/bb/image.jpg"
      />,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveClass("opacity-100");
  });
});
