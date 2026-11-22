import { describe, expect, it } from "vitest";
import {
  normalizeWheelDelta,
  wheelZoomFactor,
} from "./useImageViewerWheel";

describe("image viewer wheel helpers", () => {
  it("normalizes line and page wheel deltas", () => {
    expect(normalizeWheelDelta(3, 0)).toBe(3);
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(1, 2)).toBe(400);
  });

  it("zooms in on upward wheel and out on downward wheel", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
