import type { PageName, Route, TabName } from "../types";

const PAGE_NAMES: PageName[] = [
  "home",
  "discover",
  "creators",
  "creator",
  "post",
  "search",
  "playlist",
  "downloads",
  "settings",
];

function segment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse the small, dependency-free hash router used by the desktop shell.
 * Keeping routes in the hash means deep links keep working when the app is
 * loaded from a custom protocol (tauri://localhost) in production.
 */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?", 2);
  const parts = pathPart.split("/").filter(Boolean).map(segment);
  const name = (parts[0] ?? "home") as PageName;
  if (!PAGE_NAMES.includes(name)) return { name: "home" };

  const params = new URLSearchParams(queryPart ?? "");
  switch (name) {
    case "creator":
      if (parts[1] && parts[2]) {
        return { name, service: parts[1], creatorId: parts[2] };
      }
      return { name: "creators" };
    case "post":
      if (parts[1] && parts[2] && parts[3]) {
        return {
          name,
          service: parts[1],
          creatorId: parts[2],
          postId: parts[3],
        };
      }
      return { name: "discover" };
    case "search":
      return { name, query: params.get("q") ?? "" };
    case "creators":
      return { name, query: params.get("q") ?? "" };
    case "playlist": {
      const id = parts[1] ? Number(parts[1]) : NaN;
      return {
        name,
        playlistId: Number.isFinite(id) ? id : undefined,
      };
    }
    default:
      return { name };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "creator":
      return `#/creator/${encodeURIComponent(route.service ?? "")}/${encodeURIComponent(route.creatorId ?? "")}`;
    case "post":
      return `#/post/${encodeURIComponent(route.service ?? "")}/${encodeURIComponent(route.creatorId ?? "")}/${encodeURIComponent(route.postId ?? "")}`;
    case "search":
      return `#/search${route.query ? `?q=${encodeURIComponent(route.query)}` : ""}`;
    case "creators":
      return `#/creators${route.query ? `?q=${encodeURIComponent(route.query)}` : ""}`;
    case "playlist":
      return route.playlistId ? `#/playlist/${route.playlistId}` : "#/home";
    default:
      return `#/${route.name}`;
  }
}

interface NavigationHandler {
  navigate: (route: Route) => void;
  switchTab: (tab: TabName) => void;
  back: (fallback?: Route) => void;
  forward: () => void;
}

let navigationHandler: NavigationHandler | null = null;

/** The app store owns tab stacks; the router stays dependency-free. */
export function setNavigationHandler(handler: NavigationHandler): void {
  navigationHandler = handler;
}

function notifyLeavingPage(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pawchive:save-progress"));
  }
}

export function writeRouteHash(route: Route): void {
  if (typeof window === "undefined") return;
  const next = routeToHash(route);
  if (window.location.hash !== next) {
    window.history.replaceState(null, "", next);
  }
}

export function navigate(route: Route): void {
  notifyLeavingPage();
  if (navigationHandler) {
    navigationHandler.navigate(route);
    return;
  }
  const next = routeToHash(route);
  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = next;
  }
}

export function switchTab(tab: TabName): void {
  notifyLeavingPage();
  if (navigationHandler) {
    navigationHandler.switchTab(tab);
    return;
  }
  const next = routeToHash({ name: tab });
  if (window.location.hash !== next) window.location.hash = next;
}

export function replaceRoute(route: Route): void {
  notifyLeavingPage();
  if (navigationHandler) {
    navigationHandler.navigate(route);
    return;
  }
  writeRouteHash(route);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function goBack(fallback?: Route): void {
  notifyLeavingPage();
  if (navigationHandler) {
    navigationHandler.back(fallback);
    return;
  }
  window.history.back();
}

export function goForward(): void {
  notifyLeavingPage();
  if (navigationHandler) {
    navigationHandler.forward();
    return;
  }
  window.history.forward();
}

export function routeTitle(route: Route): string {
  switch (route.name) {
    case "home":
      return "Your playlists";
    case "discover":
      return "Discover";
    case "creators":
      return "Creators";
    case "creator":
      return "Creator";
    case "post":
      return "Post";
    case "search":
      return "Search";
    case "playlist":
      return "Playlist";
    case "downloads":
      return "Downloads";
    case "settings":
      return "Settings";
    default:
      return "Pawchive";
  }
}

export const NAV_ITEMS: Array<{ name: PageName; label: string }> = [
  { name: "home", label: "Home" },
  { name: "discover", label: "Discover" },
  { name: "creators", label: "Creators" },
  { name: "search", label: "Search" },
  { name: "downloads", label: "Downloads" },
  { name: "settings", label: "Settings" },
];
