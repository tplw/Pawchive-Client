import { useCallback, useEffect, useState } from "react";
import { currentWindow } from "../../../shared/lib/window";
import { errorMessage } from "../../../shared/lib/constants";
import { useAppStore } from "../../../app/store";

/** Track native window fullscreen and expose a toggle for the player bar. */
export function useFullscreen() {
  const toast = useAppStore((state) => state.toast);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const win = currentWindow();
    if (!win) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win.isFullscreen().then(setFullscreen).catch(() => undefined);
    };
    sync();
    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const win = currentWindow();
    if (!win) {
      toast(
        "info",
        "Fullscreen is unavailable",
        "This environment does not expose a desktop window.",
      );
      return;
    }
    try {
      const current = await win.isFullscreen().catch(() => fullscreen);
      const next = !current;
      await win.setFullscreen(next);
      setFullscreen(next);
    } catch (fullscreenError) {
      toast(
        "error",
        "Could not change fullscreen",
        errorMessage(fullscreenError),
      );
    }
  }, [fullscreen, toast]);

  return { fullscreen, setFullscreen, toggleFullscreen };
}
