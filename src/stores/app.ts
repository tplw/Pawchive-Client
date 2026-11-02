import { create } from "zustand";
import type { AppSettings, PawchiveConfig, Route, TabName } from "../types";
import { DEFAULT_SETTINGS, FALLBACK_CONFIG, errorMessage } from "../lib/constants";
import { api } from "../services/api";
import {
  parseRoute,
  routeToHash,
  setNavigationHandler,
  writeRouteHash,
} from "../lib/router";
import { queryClient } from "../lib/queryClient";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

export type IndexState = "idle" | "syncing" | "ready" | "error";

export interface TabStack {
  stack: Route[];
  index: number;
}

type TabStacks = Record<TabName, TabStack>;

interface AppStore {
  settings: AppSettings;
  config: PawchiveConfig;
  route: Route;
  previousRoute: Route | null;
  activeTab: TabName;
  tabs: TabStacks;
  ready: boolean;
  indexState: IndexState;
  indexCount: number;
  indexError: string | null;
  toasts: Toast[];
  initialize: () => Promise<void>;
  ensureCreatorIndex: (force?: boolean) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  navigate: (route: Route) => void;
  switchTab: (tab: TabName) => void;
  back: (fallback?: Route) => void;
  forward: () => void;
  syncRouteFromLocation: () => void;
  toast: (kind: ToastKind, title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  reportError: (error: unknown, title?: string) => void;
}

let toastCounter = 0;
let settingsSaveChain: Promise<void> = Promise.resolve();
const MAX_VISIBLE_TOASTS = 3;
const TAB_NAMES: TabName[] = [
  "home",
  "discover",
  "search",
  "downloads",
  "settings",
];

function initialRoute(): Route {
  if (typeof window === "undefined") return { name: "home" };
  return parseRoute(window.location.hash);
}

function rootRoute(tab: TabName): Route {
  return { name: tab };
}

function isRootTabRoute(route: Route): boolean {
  return TAB_NAMES.includes(route.name as TabName);
}

function routeEquals(left: Route, right: Route): boolean {
  return routeToHash(left) === routeToHash(right);
}

function tabForRoute(route: Route, fallback: TabName): TabName {
  if (isRootTabRoute(route)) return route.name as TabName;
  if (route.name === "playlist") return "home";
  if (
    route.name === "creator" ||
    route.name === "post" ||
    route.name === "creators"
  ) {
    return fallback === "home" ||
      fallback === "discover" ||
      fallback === "search"
      ? fallback
      : "discover";
  }
  return fallback;
}

function initialNavigation(): {
  route: Route;
  activeTab: TabName;
  tabs: TabStacks;
  previousRoute: Route | null;
} {
  const route = initialRoute();
  const activeTab = tabForRoute(route, "discover");
  const root = rootRoute(activeTab);
  const stack = routeEquals(route, root) ? [root] : [root, route];
  const tabs = Object.fromEntries(
    TAB_NAMES.map((tab) => [
      tab,
      { stack: [rootRoute(tab)], index: 0 } satisfies TabStack,
    ]),
  ) as TabStacks;
  tabs[activeTab] = { stack, index: stack.length - 1 };
  return {
    route,
    activeTab,
    tabs,
    previousRoute: stack.length > 1 ? root : null,
  };
}

const initial = initialNavigation();

export const useAppStore = create<AppStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  config: FALLBACK_CONFIG,
  route: initial.route,
  previousRoute: initial.previousRoute,
  activeTab: initial.activeTab,
  tabs: initial.tabs,
  ready: false,
  indexState: "idle",
  indexCount: 0,
  indexError: null,
  toasts: [],

  initialize: async () => {
    try {
      const [settings, config] = await Promise.all([
        api.getSettings(),
        api.getConfig(),
      ]);
      set({ settings, config, ready: true });
      void get().ensureCreatorIndex();
      if (settings.autoSyncFavorites) {
        void (async () => {
          try {
            const account = await api.getAccountState();
            if (!account.loggedIn) return;
            await api.syncAccountFavorites();
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["favorites", "creators"],
              }),
              queryClient.invalidateQueries({ queryKey: ["creators"] }),
            ]);
          } catch {
            // Auto-sync is best-effort; the account may be offline/expired.
          }
        })();
      }
    } catch (error) {
      set({ ready: true });
      get().reportError(error, "Could not start Pawchive Desktop");
    }
  },

  ensureCreatorIndex: async (force = false) => {
    if (get().indexState === "syncing") return;
    set({ indexState: "syncing", indexError: null });
    try {
      const existing = await api.getCreatorCount();
      if (existing > 0 && !force) {
        set({ indexState: "ready", indexCount: existing });
        return;
      }
      const total = await api.syncCreators();
      set({ indexState: "ready", indexCount: total });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["creators"] }),
        queryClient.invalidateQueries({ queryKey: ["posts"] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
        queryClient.invalidateQueries({ queryKey: ["creator-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["post"] }),
      ]);
    } catch (error) {
      const message = errorMessage(error);
      set({ indexState: "error", indexError: message });
      if (force) get().reportError(error, "Could not refresh the creator index");
    }
  },

  saveSettings: (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    const run = settingsSaveChain.then(async () => {
      try {
        const saved = await api.saveSettings(next);
        // Ignore stale responses when another setting changed while this
        // request was in flight.
        if (get().settings === next) {
          set({ settings: saved });
        }
      } catch (error) {
        if (get().settings !== next) return;
        const persisted = await api.getSettings().catch(() => previous);
        set({ settings: persisted ?? previous });
        get().reportError(error, "Could not save settings");
      }
    });
    settingsSaveChain = run.catch(() => undefined);
    return run;
  },

  navigate: (route) => {
    const state = get();
    const targetTab = tabForRoute(route, state.activeTab);
    if (
      targetTab === state.activeTab &&
      routeEquals(state.route, route)
    ) {
      return;
    }

    let tabs = state.tabs;
    if (targetTab !== state.activeTab && isRootTabRoute(route)) {
      tabs = {
        ...state.tabs,
        [targetTab]: { stack: [route], index: 0 },
      };
    } else if (isRootTabRoute(route)) {
      tabs = {
        ...state.tabs,
        [targetTab]: { stack: [route], index: 0 },
      };
    } else {
      const current = state.tabs[targetTab];
      const stack = [
        ...current.stack.slice(0, current.index + 1),
        route,
      ];
      tabs = {
        ...state.tabs,
        [targetTab]: { stack, index: stack.length - 1 },
      };
    }

    const active = tabs[targetTab];
    writeRouteHash(route);
    set({
      tabs,
      activeTab: targetTab,
      route,
      previousRoute: active.stack[active.index - 1] ?? null,
    });
  },

  switchTab: (tab) => {
    const state = get();
    if (tab === state.activeTab) {
      const current = state.tabs[tab];
      if (current.index > 0) {
        const root = rootRoute(tab);
        const tabs = {
          ...state.tabs,
          [tab]: { stack: [root], index: 0 },
        };
        writeRouteHash(root);
        set({ tabs, route: root, previousRoute: null });
      } else {
        window.dispatchEvent(new Event("pawchive:scroll-top"));
      }
      return;
    }

    const target = state.tabs[tab];
    const route = target.stack[target.index] ?? rootRoute(tab);
    writeRouteHash(route);
    set({
      activeTab: tab,
      route,
      previousRoute: target.stack[target.index - 1] ?? null,
    });
  },

  back: (fallback) => {
    const state = get();
    const active = state.tabs[state.activeTab];
    if (active.index > 0) {
      const index = active.index - 1;
      const route = active.stack[index];
      const tabs = {
        ...state.tabs,
        [state.activeTab]: { ...active, index },
      };
      writeRouteHash(route);
      set({
        tabs,
        route,
        previousRoute: active.stack[index - 1] ?? null,
      });
      return;
    }
    if (fallback) get().navigate(fallback);
  },

  forward: () => {
    const state = get();
    const active = state.tabs[state.activeTab];
    if (active.index >= active.stack.length - 1) return;
    const index = active.index + 1;
    const route = active.stack[index];
    const tabs = {
      ...state.tabs,
      [state.activeTab]: { ...active, index },
    };
    writeRouteHash(route);
    set({
      tabs,
      route,
      previousRoute: active.stack[index - 1] ?? null,
    });
  },

  syncRouteFromLocation: () => {
    const next = parseRoute(window.location.hash);
    const state = get();
    if (routeEquals(state.route, next)) return;
    get().navigate(next);
  },

  toast: (kind, title, message) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { id, kind, title, message }].slice(
        -MAX_VISIBLE_TOASTS,
      ),
    }));

    window.setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 4200);
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  reportError: (error, title = "Something went wrong") => {
    get().toast("error", title, errorMessage(error));
  },
}));

setNavigationHandler({
  navigate: (route) => useAppStore.getState().navigate(route),
  switchTab: (tab) => useAppStore.getState().switchTab(tab),
  back: (fallback) => useAppStore.getState().back(fallback),
  forward: () => useAppStore.getState().forward(),
});
