import { useEffect } from "react";
import { isEditableTarget } from "../../../lib/format";
import { currentWindow } from "../../../lib/window";
import { usePlayerStore } from "../../../player/store";

/** Global media shortcuts, active only while the player is expanded. */
export function usePlayerKeyboard({
  fullscreen,
  setFullscreen,
  toggleFullscreen,
  togglePlayback,
}: {
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
  toggleFullscreen: () => void;
  togglePlayback: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = usePlayerStore.getState();
      // Only capture media keys while the player is expanded. A collapsed
      // mini-player must not steal Space/arrows from the page underneath.
      if (!state.currentId || !state.expanded) return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case " ":
          event.preventDefault();
          togglePlayback();
          break;
        case "arrowleft":
          event.preventDefault();
          state.seek(Math.max(0, state.currentTime - 10));
          break;
        case "arrowright":
          event.preventDefault();
          state.seek(state.currentTime + 10);
          break;
        case "arrowup":
          event.preventDefault();
          state.setVolume(Math.min(1, state.volume + 0.05));
          break;
        case "arrowdown":
          event.preventDefault();
          state.setVolume(Math.max(0, state.volume - 0.05));
          break;
        case "m":
          state.toggleMute();
          break;
        case "f":
          if (state.expanded) void toggleFullscreen();
          break;
        case "escape":
          if (usePlayerStore.getState().expanded) {
            if (fullscreen) {
              const win = currentWindow();
              if (win) {
                void win
                  .setFullscreen(false)
                  .then(() => setFullscreen(false))
                  .catch(() => undefined);
              }
            }
            usePlayerStore.getState().setExpanded(false);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen, toggleFullscreen, togglePlayback]);
}
