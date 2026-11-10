import { describe, expect, it } from "vitest";
import { resolvePictureInPictureSupport } from "./usePictureInPicture";

describe("picture-in-picture support", () => {
  it("is disabled on desktop", () => {
    expect(
      resolvePictureInPictureSupport({
        mobile: false,
        enabled: true,
        standard: true,
        webkit: true,
      }),
    ).toBeNull();
  });

  it("uses the standard API when available", () => {
    expect(
      resolvePictureInPictureSupport({
        mobile: true,
        enabled: true,
        standard: true,
        webkit: false,
      }),
    ).toBe("standard");
  });

  it("falls back to the iOS presentation mode", () => {
    expect(
      resolvePictureInPictureSupport({
        mobile: true,
        enabled: false,
        standard: false,
        webkit: true,
      }),
    ).toBe("webkit");
  });

  it("reports no support when neither API exists", () => {
    expect(
      resolvePictureInPictureSupport({
        mobile: true,
        enabled: true,
        standard: false,
        webkit: false,
      }),
    ).toBeNull();
  });
});
