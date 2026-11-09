import { useLayoutEffect, useMemo, useRef, useEffect, type RefObject } from "react";
import { markNavigation } from "../../lib/perf";
import { routeTitle, routeToHash } from "../../lib/router";
import type { Route } from "../../types";

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

/** Preserve per-route scroll offsets while pages mount and restore them. */
export function useScrollRestoration({
  ready,
  mainRef,
  route,
}: {
  ready: boolean;
  mainRef: RefObject<HTMLElement | null>;
  route: Route;
}) {
  const scrollPositions = useRef(useMemo(readScrollPositions, []));
  const scrollKey = routeToHash(route);
  const pageKey = route.name === "search" ? "#/search" : scrollKey;
  const pageName = route.name;
  const pageTitle = routeTitle(route);
  const activeScrollKey = useRef(scrollKey);
  const suppressScrollSave = useRef(false);

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
  }, [ready, mainRef]);

  useLayoutEffect(() => {
    if (!ready) return;
    const main = mainRef.current;
    if (!main) return;
    persistScrollPositions(scrollPositions.current);
    activeScrollKey.current = scrollKey;
    markNavigation(pageName);
    document.title = `Pawchive · ${pageTitle}`;

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

    main.addEventListener("wheel", stopRestoring, {
      passive: true,
      once: true,
    });
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
  }, [pageName, pageTitle, ready, scrollKey, mainRef]);

  return { pageKey };
}
