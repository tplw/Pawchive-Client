import { describe, expect, it } from "vitest";
import { isHlsUrl } from "../../player/model/useMediaSource";
import { clampPan } from "./useImageViewerGestures";

describe("media URL helpers", () => {
  it("recognizes HLS manifests with query strings", () => {
    expect(isHlsUrl("https://cdn.example/master.m3u8?e=1&s=abc")).toBe(true);
    expect(isHlsUrl("https://cdn.example/clip.mp4")).toBe(false);
  });

  it("clamps pan distance to the zoomed viewport", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    try {
      expect(clampPan({ x: 0, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
      expect(clampPan({ x: 9999, y: -9999 }, 2)).toEqual({
        x: 500,
        y: -400,
      });
      expect(clampPan({ x: -70, y: 40 }, 1.5)).toEqual({ x: -70, y: 40 });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });
});
