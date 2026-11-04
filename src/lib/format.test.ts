import { describe, expect, it } from "vitest";
import { cn, formatDate, formatDuration, shortNumber } from "./format";

describe("format helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(-1)).toBe("0:00");
    expect(formatDuration(null)).toBe("0:00");
  });

  it("formats compact numbers", () => {
    expect(shortNumber(999)).toBe("999");
    expect(shortNumber(12_500)).toBe("13k");
    expect(shortNumber(2_500_000)).toBe("2.5m");
  });

  it("formats dates and handles missing timestamps", () => {
    expect(formatDate(null)).toBe("Unknown date");
    expect(formatDate(1700000000)).toContain("2023");
  });

  it("joins class names", () => {
    expect(cn("a", false, null, "b")).toBe("a b");
  });
});
