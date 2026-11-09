import {
  parseRoute,
  routeToHash,
  writeRouteHash,
} from "../../shared/lib/router";
import type { Route, TabName } from "../../shared/types";
import type { AppStore, AppStoreApi, TabStacks } from "./types";

const TAB_NAMES: TabName[] = [
  "home",
  "discover",
  "search",
  "downloads",
  "settings",
];

function rootRoute(tab: TabName): Route {
  return { name: tab };
}

function isRootTabRoute(route: Route): boolean {
  return TAB_NAMES.includes(route.name as TabName);
}

function routeEquals(left: Route, right: Route): boolean {
  return routeToHash(left) === routeToHash(right);
}

export function tabForRoute(route: Route, fallback: TabName): TabName {
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

export function initialNavigation(): {
  route: Route;
  activeTab: TabName;
  tabs: TabStacks;
  previousRoute: Route | null;
} {
  const route =
    typeof window === "undefined"
      ? { name: "home" as const }
      : parseRoute(window.location.hash);
  const activeTab = tabForRoute(route, "discover");
  const root = rootRoute(activeTab);
  const stack = routeEquals(route, root) ? [root] : [root, route];
  const tabs = Object.fromEntries(
    TAB_NAMES.map((tab) => [
      tab,
      { stack: [rootRoute(tab)], index: 0 },
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

export function createNavigationActions({
  get,
  set,
}: AppStoreApi): Pick<
  AppStore,
  "navigate" | "switchTab" | "back" | "forward" | "syncRouteFromLocation"
> {
  return {
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
  };
}
