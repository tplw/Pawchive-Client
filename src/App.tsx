import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { MobileTabBar } from "./components/MobileTabBar";
import { TopBar } from "./components/TopBar";
import { Player } from "./player/Player";
import { Button, Toaster } from "./components/ui";
import { hexToRgbTriplet, isEditableTarget } from "./lib/format";
import { markNavigation } from "./lib/perf";
import {
  goBack,
  routeTitle,
  routeToHash,
  switchTab,
} from "./lib/router";
import { useAppStore } from "./stores/app";
import { usePlayerStore } from "./player/store";
import { queryClient } from "./lib/queryClient";
import { isAndroid, isMobile } from "./lib/platform";
import { handleAndroidBack } from "./lib/backNavigation";
import type { DownloadRecord, Route } from "./types";
import { HomePage } from "./pages/Home";
import { DiscoverPage } from "./pages/Discover";
import { CreatorsPage } from "./pages/Creators";
import { CreatorProfilePage } from "./pages/CreatorProfile";
import { PostDetailPage } from "./pages/PostDetail";
import { SearchPage } from "./pages/Search";
import { PlaylistPage } from "./pages/Playlist";
import { DownloadsPage } from "./pages/Downloads";
import { SettingsPage } from "./pages/Settings";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Pawchive interface error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-screen place-items-center bg-base px-6 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-ink">
              The interface hit an unexpected error
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {this.state.error.message}
            </p>
            <Button
              className="mt-5"
              variant="primary"
              onClick={() => window.location.reload()}
            >
              Reload Pawchive
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RoutePage({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "discover":
      return <DiscoverPage />;
    case "creators":
      return <CreatorsPage query={route.query ?? ""} />;
    case "creator":
      if (route.service && route.creatorId) {
        return (
          <CreatorProfilePage
            service={route.service}
            creatorId={route.creatorId}
          />
        );
      }
      return <CreatorsPage />;
    case "post":
      if (route.service && route.creatorId && route.postId) {
        return (
          <PostDetailPage
            key={`${route.service}:${route.creatorId}:${route.postId}`}
            service={route.service}
            creatorId={route.creatorId}
            postId={route.postId}
          />
        );
      }
      return <DiscoverPage />;
    case "search":
      return <SearchPage query={route.query ?? ""} />;
    case "playlist":
      return route.playlistId ? (
        <PlaylistPage playlistId={route.playlistId} />
      ) : (
        <HomePage />
      );
    case "downloads":
      return <DownloadsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

const SCROLL_STORAGE_KEY = "pawchive-scroll-positions";

function readScrollPositions(): Map<string, number> {
  try {
    const raw = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

function persistScrollPositions(positions: Map<string, number>): void {
  try {
    window.sessionStorage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(positions)),
    );
  } catch {
    // Private browsing or a restricted webview can deny session storage.
  }
}

function LoadingScreen() {
  return (
    <div className="grid h-screen place-items-center bg-base">
      <img src="/paw-logo.png" alt="Pawchive" className="h-40 w-40" />
    </div>
  );
}

export default function App() {
  const ready = useAppStore((state) => state.ready);
  const route = useAppStore((state) => state.route);
  const settings = useAppStore((state) => state.settings);
  const initialize = useAppStore((state) => state.initialize);
  const syncRoute = useAppStore((state) => state.syncRouteFromLocation);
  const toast = useAppStore((state) => state.toast);
  const mainRef = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const scrollPositions = useRef(useMemo(readScrollPositions, []));
  const scrollKey = routeToHash(route);
  const pageKey = route.name === "search" ? "#/search" : scrollKey;
  const pageName = route.name;
  const pageTitle = routeTitle(route);
  const activeScrollKey = useRef(scrollKey);
  const suppressScrollSave = useRef(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    document.documentElement.dataset.platform = /iPhone|iPad|iPod/.test(userAgent)
      ? "ios"
      : /Android/.test(userAgent)
        ? "android"
        : /Macintosh/.test(userAgent)
          ? "macos"
          : /Windows/.test(userAgent)
            ? "windows"
            : "linux";
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/home");
    }
    const onHash = () => {
      // Persist the current watch position before leaving the current view.
      window.dispatchEvent(new Event("pawchive:save-progress"));
      syncRoute();
    };
    window.addEventListener("hashchange", onHash);
    syncRoute();
    return () => window.removeEventListener("hashchange", onHash);
  }, [syncRoute]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings.reduceMotion
      ? "true"
      : "false";
  }, [settings.reduceMotion]);

  useEffect(() => {
    const triplet = hexToRgbTriplet(settings.accentColor) ?? "214 174 168";
    document.documentElement.style.setProperty("--accent", triplet);
    const [r, g, b] = triplet.split(" ").map(Number);
    document.documentElement.style.setProperty(
      "--accent-soft",
      `${Math.round(r * 0.36)} ${Math.round(g * 0.36)} ${Math.round(b * 0.36)}`,
    );
  }, [settings.accentColor]);

  useEffect(() => {
    if (!ready) return;
    const player = usePlayerStore.getState();
    player.setVolume(settings.volume);
    player.setSpeed(settings.playbackSpeed);
  }, [ready, settings.volume, settings.playbackSpeed]);

  useEffect(() => {
    if (!ready) return;
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => {
      if (suppressScrollSave.current) return;
      scrollPositions.current.set(activeScrollKey.current, main.scrollTop);
    };
    const onPageHide = () => persistScrollPositions(scrollPositions.current);
    const onScrollTop = () => {
      main.scrollTop = 0;
      scrollPositions.current.set(activeScrollKey.current, 0);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pawchive:scroll-top", onScrollTop);
    return () => {
      main.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pawchive:scroll-top", onScrollTop);
    };
  }, [ready]);

  useLayoutEffect(() => {
    if (!ready) return;
    const main = mainRef.current;
    if (!main) return;
    persistScrollPositions(scrollPositions.current);
    activeScrollKey.current = scrollKey;
    markNavigation(pageName);
    document.title = `Pawchive Client · ${pageTitle}`;

    const target = scrollPositions.current.get(scrollKey) ?? 0;
    suppressScrollSave.current = true;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;

    const stopRestoring = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      suppressScrollSave.current = false;
    };

    const restore = () => {
      if (cancelled) return;
      const max = Math.max(0, main.scrollHeight - main.clientHeight);
      main.scrollTop = Math.min(target, max);
      attempts += 1;
      if (attempts < 180 && Math.abs(main.scrollTop - target) > 1) {
        frame = window.requestAnimationFrame(restore);
      } else {
        suppressScrollSave.current = false;
      }
    };

    main.addEventListener("wheel", stopRestoring, { passive: true, once: true });
    main.addEventListener("touchstart", stopRestoring, {
      passive: true,
      once: true,
    });
    main.addEventListener("pointerdown", stopRestoring, {
      passive: true,
      once: true,
    });
    restore();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      suppressScrollSave.current = false;
      main.removeEventListener("wheel", stopRestoring);
      main.removeEventListener("touchstart", stopRestoring);
      main.removeEventListener("pointerdown", stopRestoring);
    };
  }, [pageName, pageTitle, ready, scrollKey]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    void listen<DownloadRecord>("download://progress", () => {
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    }).then((fn) => {
      unlistenProgress = fn;
    });
    void listen<DownloadRecord>("download://complete", () => {
      // Completion is visible in the Downloads page. Avoid one toast per file
      // when a post or playlist queues dozens of downloads.
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      void queryClient.invalidateQueries({ queryKey: ["playlist-items"] });
    }).then((fn) => {
      unlistenComplete = fn;
    });
    void listen<DownloadRecord>("download://error", (event) => {
      toast("error", "Download failed", event.payload.error ?? event.payload.fileName);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    }).then((fn) => {
      unlistenError = fn;
    });
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, [toast]);

  useEffect(() => {
    if (!isMobile) return;
    let tracking = false;
    let startX = 0;
    let startY = 0;
    let playerExpanded = false;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      const expanded = usePlayerStore.getState().expanded;
      if (!expanded && useAppStore.getState().route.name === "home") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea")) return;
      const touch = event.touches[0];
      if (touch.clientX > 28) return;
      tracking = true;
      playerExpanded = expanded;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx > 72 && dy < 50) {
        tracking = false;
        if (playerExpanded) {
          window.dispatchEvent(new Event("pawchive:close-queue"));
        } else {
          goBack();
        }
      } else if (dx < -10 || dy > 60) {
        tracking = false;
      }
    };
    const onTouchEnd = () => {
      tracking = false;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    let disposed = false;
    let unregister: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (handleAndroidBack() === "exit") void exit(0);
    })
      .then((listener) => {
        if (disposed) void listener.unregister();
        else unregister = () => void listener.unregister();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unregister?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (useAppStore.getState().route.name === "search") {
          window.dispatchEvent(new CustomEvent("pawchive:focus-search"));
        } else {
          switchTab("search");
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent("pawchive:focus-search")),
            80,
          );
        }
        return;
      }
      if (!mod || isEditableTarget(event.target)) return;
      const key = event.key;
      if (key === "1") {
        event.preventDefault();
        switchTab("home");
      } else if (key === "2") {
        event.preventDefault();
        switchTab("discover");
      } else if (key === "3") {
        event.preventDefault();
        switchTab("search");
      } else if (key === "4") {
        event.preventDefault();
        switchTab("downloads");
      } else if (key === "5") {
        event.preventDefault();
        switchTab("settings");
      } else if (key === ",") {
        event.preventDefault();
        switchTab("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <LoadingScreen />;

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-base text-ink">
      {!isMobile ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          ref={mainRef}
          id="main-scroll"
          className="main-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-7"
        >
          <div key={pageKey} className="animate-fade-in">
            <ErrorBoundary>
              <RoutePage route={route} />
            </ErrorBoundary>
          </div>
        </main>
        <Player />
        {isMobile ? <MobileTabBar /> : null}
      </div>
      <Toaster />
    </div>
  );
}
