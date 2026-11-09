import { useEffect } from "react";
import { useAppStore } from "../store";

/** Restore the hash route and keep it in sync with browser navigation. */
export function useHashSync() {
  const syncRoute = useAppStore((state) => state.syncRouteFromLocation);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    document.documentElement.dataset.platform = /iPhone|iPad|iPod/.test(
      userAgent,
    )
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
}
