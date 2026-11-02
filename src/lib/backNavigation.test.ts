import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store";
import { useAppStore } from "../stores/app";
import { handleAndroidBack } from "./backNavigation";

const ROOT_TABS = {
  home: { stack: [{ name: "home" as const }], index: 0 },
  discover: { stack: [{ name: "discover" as const }], index: 0 },
  search: { stack: [{ name: "search" as const }], index: 0 },
  downloads: { stack: [{ name: "downloads" as const }], index: 0 },
  settings: { stack: [{ name: "settings" as const }], index: 0 },
};

function resetStores() {
  useAppStore.setState({
    route: { name: "home" },
    previousRoute: null,
    activeTab: "home",
    tabs: structuredClone(ROOT_TABS),
  });
  usePlayerStore.setState({ expanded: false });
}

describe("Android back navigation", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("closes an open modal first", () => {
    document.body.innerHTML = '<div data-modal-open="true"></div>';
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    expect(handleAndroidBack()).toBe("handled");
    expect(onKey).toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" }),
    );
    window.removeEventListener("keydown", onKey);
  });

  it("dismisses the full-screen player", () => {
    usePlayerStore.setState({ expanded: true });
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    expect(handleAndroidBack()).toBe("handled");
    expect(onKey).toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" }),
    );
    window.removeEventListener("keydown", onKey);
  });

  it("walks back through the active tab stack", () => {
    useAppStore.setState({
      activeTab: "discover",
      route: { name: "creator", service: "patreon", creatorId: "42" },
      tabs: {
        ...structuredClone(ROOT_TABS),
        discover: {
          stack: [
            { name: "discover" },
            { name: "creator", service: "patreon", creatorId: "42" },
          ],
          index: 1,
        },
      },
    });

    expect(handleAndroidBack()).toBe("handled");
    expect(useAppStore.getState().route.name).toBe("discover");
    expect(useAppStore.getState().tabs.discover.index).toBe(0);
  });

  it("returns to Home from another root tab", () => {
    useAppStore.setState({
      activeTab: "search",
      route: { name: "search" },
      tabs: structuredClone(ROOT_TABS),
    });

    expect(handleAndroidBack()).toBe("handled");
    expect(useAppStore.getState().activeTab).toBe("home");
    expect(useAppStore.getState().route.name).toBe("home");
  });

  it("lets the caller close the app at the Home root", () => {
    expect(handleAndroidBack()).toBe("exit");
  });
});
