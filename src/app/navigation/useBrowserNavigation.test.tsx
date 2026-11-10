import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { wireNavigation } from "../bootstrap/wireNavigation";
import { swipeAction, useBrowserNavigation } from "./useBrowserNavigation";

const rootTabs = {
  home: { stack: [{ name: "home" as const }], index: 0 },
  discover: { stack: [{ name: "discover" as const }], index: 0 },
  search: { stack: [{ name: "search" as const }], index: 0 },
  downloads: { stack: [{ name: "downloads" as const }], index: 0 },
  settings: { stack: [{ name: "settings" as const }], index: 0 },
};

function reset() {
  wireNavigation();
  useAppStore.setState({
    route: { name: "home" },
    previousRoute: null,
    activeTab: "home",
    tabs: {
      ...structuredClone(rootTabs),
      home: {
        stack: [{ name: "home" }, { name: "creator", service: "patreon", creatorId: "1" }],
        index: 1,
      },
    },
  });
}

describe("browser-style navigation", () => {
  beforeEach(reset);

  it("classifies only horizontal swipes", () => {
    expect(swipeAction(-60, 0)).toBe("back");
    expect(swipeAction(60, 0)).toBe("forward");
    expect(swipeAction(-30, 0)).toBeNull();
    expect(swipeAction(-60, 30)).toBeNull();
  });

  it("handles mouse back and forward buttons", () => {
    const { unmount } = renderHook(() => useBrowserNavigation());
    window.dispatchEvent(new MouseEvent("mouseup", { button: 3 }));
    expect(useAppStore.getState().route.name).toBe("home");

    window.dispatchEvent(new MouseEvent("mouseup", { button: 4 }));
    expect(useAppStore.getState().route.name).toBe("creator");
    unmount();
  });

  it("handles trackpad swipes with a cooldown", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useBrowserNavigation());
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaX: -60, deltaY: 0, bubbles: true }),
      );
      expect(useAppStore.getState().route.name).toBe("home");

      vi.advanceTimersByTime(800);
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 60, deltaY: 0, bubbles: true }),
      );
      expect(useAppStore.getState().route.name).toBe("creator");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
