import { useEffect } from "react";
import { isEditableTarget } from "../../../shared/lib/format";
import { usePlayerStore } from "./store";

/**
 * Global media shortcuts. Playback and mute work in both the compact bar and
 * the expanded player. F toggles between the two, while seeking and Escape
 * stay expanded-only so the page underneath keeps its normal keys.
 */
export function usePlayerKeyboard({
  togglePlayback,
  onToggleExpanded,
  onCollapse,
}: {
  togglePlayback: () => void;
  onToggleExpanded: () => void;
  onCollapse: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = usePlayerStore.getState();
      if (!state.currentId) return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {
        if (event.repeat) return;
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (key === "m") {
        if (event.repeat) return;
        event.preventDefault();
        state.toggleMute();
        return;
      }
      if (key === "f") {
        if (event.repeat) return;
        event.preventDefault();
        onToggleExpanded();
        return;
      }

      // The remaining shortcuts only make sense in the expanded player.
      if (!state.expanded) return;

      switch (key) {
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
        case "escape":
          onCollapse();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCollapse, onToggleExpanded, togglePlayback]);
}
