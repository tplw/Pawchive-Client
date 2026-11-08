import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS, FALLBACK_CONFIG } from "../lib/constants";
import {
  loadCreatorFilter,
  saveCreatorFilter,
  setGlobalHideNoMediaDefault,
} from "../lib/creatorFilters";
import { switchTab } from "../lib/router";
import { api } from "../services/api";
import { pendingUpdateVersion, useAppStore } from "./app";

vi.mock("../services/api", () => ({
  api: {
    saveSettings: vi.fn(),
    getSettings: vi.fn(),
    getConfig: vi.fn(),
    getCreatorCount: vi.fn(),
    syncCreators: vi.fn(),
    getAccountState: vi.fn(),
    syncAccountFavorites: vi.fn(),
    checkForUpdate: vi.fn(),
  },
}));

describe("app store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setGlobalHideNoMediaDefault(false);
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      route: { name: "home" },
      previousRoute: null,
      activeTab: "home",
      tabs: {
        home: { stack: [{ name: "home" }], index: 0 },
        discover: { stack: [{ name: "discover" }], index: 0 },
        search: { stack: [{ name: "search" }], index: 0 },
        downloads: { stack: [{ name: "downloads" }], index: 0 },
        settings: { stack: [{ name: "settings" }], index: 0 },
      },
      toasts: [],
      ready: true,
      indexState: "idle",
      indexCount: 0,
      indexError: null,
      updateInfo: null,
      updateChecking: false,
      updateError: null,
    });
  });

  it("tracks the previous route for detail-page back navigation", () => {
    window.location.hash = "#/discover";
    useAppStore.getState().syncRouteFromLocation();
    expect(useAppStore.getState().route.name).toBe("discover");
    window.location.hash = "#/creator/patreon/42";
    useAppStore.getState().syncRouteFromLocation();
    expect(useAppStore.getState().route.name).toBe("creator");
    expect(useAppStore.getState().previousRoute?.name).toBe("discover");
  });

  it("keeps separate navigation stacks for each tab", () => {
    const store = useAppStore.getState();
    store.navigate({
      name: "creator",
      service: "patreon",
      creatorId: "42",
    });
    store.navigate({
      name: "post",
      service: "patreon",
      creatorId: "42",
      postId: "99",
    });
    expect(useAppStore.getState().activeTab).toBe("home");
    expect(useAppStore.getState().route.name).toBe("post");

    useAppStore.getState().switchTab("downloads");
    expect(useAppStore.getState().activeTab).toBe("downloads");
    expect(useAppStore.getState().route.name).toBe("downloads");

    useAppStore.getState().switchTab("home");
    expect(useAppStore.getState().activeTab).toBe("home");
    expect(useAppStore.getState().route.name).toBe("post");

    useAppStore.getState().back();
    expect(useAppStore.getState().route.name).toBe("creator");
    useAppStore.getState().back();
    expect(useAppStore.getState().route.name).toBe("home");
  });

  it("restores a tab through the router without resetting its stack", () => {
    useAppStore.getState().navigate({
      name: "creator",
      service: "patreon",
      creatorId: "42",
    });
    useAppStore.getState().navigate({
      name: "post",
      service: "patreon",
      creatorId: "42",
      postId: "99",
    });
    switchTab("downloads");
    expect(useAppStore.getState().route.name).toBe("downloads");
    switchTab("home");
    expect(useAppStore.getState().route.name).toBe("post");
    expect(useAppStore.getState().activeTab).toBe("home");
  });

  it("auto-syncs account favorites when the setting is enabled", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      autoSyncFavorites: true,
    });
    vi.mocked(api.getConfig).mockResolvedValue(FALLBACK_CONFIG);
    vi.mocked(api.getCreatorCount).mockResolvedValue(100);
    vi.mocked(api.getAccountState).mockResolvedValue({
      loggedIn: true,
      username: "ada",
    });
    vi.mocked(api.syncAccountFavorites).mockResolvedValue(3);
    await useAppStore.getState().initialize();
    await waitFor(() => expect(api.syncAccountFavorites).toHaveBeenCalledOnce());
  });

  it("optimistically applies and persists a settings patch", async () => {
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
    await useAppStore
      .getState()
      .saveSettings({ sidebarVisible: false, volume: 0.4 });
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ sidebarVisible: false, volume: 0.4 }),
    );
    expect(useAppStore.getState().settings.sidebarVisible).toBe(false);
    expect(useAppStore.getState().settings.volume).toBe(0.4);
  });

  it("applies the global hideNoMedia toggle to every creator filter", async () => {
    saveCreatorFilter("patreon", "1", {
      audioOnly: false,
      hideNoMedia: false,
      hideUnavailable: false,
      keywords: ["sketch"],
    });
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
    await useAppStore.getState().saveSettings({ hideNoMedia: true });
    expect(loadCreatorFilter("patreon", "1")).toMatchObject({
      hideNoMedia: true,
      keywords: ["sketch"],
    });
  });

  it("serializes rapid settings updates without stale overwrites", async () => {
    const calls: boolean[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => {
      calls.push(settings.sidebarVisible);
      if (calls.length === 1) await firstSave;
      return settings;
    });
    const first = useAppStore
      .getState()
      .saveSettings({ sidebarVisible: false });
    const second = useAppStore.getState().saveSettings({ volume: 0.3 });
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(calls).toEqual([false, false]);
    expect(useAppStore.getState().settings.sidebarVisible).toBe(false);
    expect(useAppStore.getState().settings.volume).toBe(0.3);
  });

  it("rolls back when persistence fails", async () => {
    vi.mocked(api.saveSettings).mockRejectedValueOnce({
      code: "io",
      message: "disk full",
      retryable: false,
    });
    await useAppStore.getState().saveSettings({ sidebarVisible: false });
    expect(useAppStore.getState().settings.sidebarVisible).toBe(true);
    const toast =
      useAppStore.getState().toasts[useAppStore.getState().toasts.length - 1];
    expect(toast?.kind).toBe("error");
    expect(toast?.message).toContain("disk full");
  });

  it("keeps the toast stack compact", () => {
    for (let index = 0; index < 5; index += 1) {
      useAppStore.getState().toast("info", `Note ${index}`);
    }
    const toasts = useAppStore.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts.map((toast) => toast.title)).toEqual([
      "Note 2",
      "Note 3",
      "Note 4",
    ]);
  });

  it("announces a new release once and remembers the dismissal", async () => {
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
    vi.mocked(api.checkForUpdate).mockResolvedValue({
      currentVersion: "1.0.3.1",
      latestVersion: "1.0.4",
      updateAvailable: true,
      url: "https://example.com/releases",
      releaseName: "Pawchive 1.0.4",
    });

    await useAppStore.getState().checkForUpdates({ silent: true });
    let state = useAppStore.getState();
    expect(pendingUpdateVersion(state.updateInfo, state.settings)).toBe("1.0.4");
    // The popup replaces the startup toast, so silent checks stay quiet.
    expect(state.toasts).toHaveLength(0);

    await useAppStore.getState().dismissUpdate();
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ dismissedUpdateVersion: "1.0.4" }),
    );
    state = useAppStore.getState();
    expect(state.settings.dismissedUpdateVersion).toBe("1.0.4");
    expect(pendingUpdateVersion(state.updateInfo, state.settings)).toBeNull();

    // The same release never prompts again, even on another startup check.
    await useAppStore.getState().checkForUpdates({ silent: true });
    state = useAppStore.getState();
    expect(pendingUpdateVersion(state.updateInfo, state.settings)).toBeNull();
    expect(state.toasts).toHaveLength(0);

    // A manual check still reports the skipped release as a toast.
    await useAppStore.getState().checkForUpdates();
    state = useAppStore.getState();
    expect(state.toasts[state.toasts.length - 1]?.title).toBe(
      "Update available",
    );
  });

  it("prompts again when a newer release appears", async () => {
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
    vi.mocked(api.checkForUpdate).mockResolvedValue({
      currentVersion: "1.0.3.1",
      latestVersion: "1.0.4",
      updateAvailable: true,
      url: "https://example.com/releases",
      releaseName: null,
    });
    await useAppStore.getState().checkForUpdates({ silent: true });
    await useAppStore.getState().dismissUpdate();

    vi.mocked(api.checkForUpdate).mockResolvedValue({
      currentVersion: "1.0.3.1",
      latestVersion: "1.0.4.1",
      updateAvailable: true,
      url: "https://example.com/releases",
      releaseName: null,
    });
    await useAppStore.getState().checkForUpdates({ silent: true });
    const state = useAppStore.getState();
    expect(pendingUpdateVersion(state.updateInfo, state.settings)).toBe(
      "1.0.4.1",
    );
    expect(state.toasts).toHaveLength(0);
  });

  it("uses an existing creator index without syncing again", async () => {
    vi.mocked(api.getCreatorCount).mockResolvedValue(98_000);
    await useAppStore.getState().ensureCreatorIndex();
    expect(api.syncCreators).not.toHaveBeenCalled();
    expect(useAppStore.getState().indexState).toBe("ready");
    expect(useAppStore.getState().indexCount).toBe(98_000);
  });

  it("downloads the creator index when it is empty", async () => {
    vi.mocked(api.getCreatorCount).mockResolvedValue(0);
    vi.mocked(api.syncCreators).mockResolvedValue(98_000);
    await useAppStore.getState().ensureCreatorIndex();
    expect(api.syncCreators).toHaveBeenCalledOnce();
    expect(useAppStore.getState().indexState).toBe("ready");
    expect(useAppStore.getState().indexCount).toBe(98_000);
  });
});
