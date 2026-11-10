import { useEffect } from "react";
import type { QueueItem } from "../../../shared/types";
import { usePlayerStore } from "./store";

type ActionHandler = (details: MediaSessionActionDetails) => void;

function hasMediaSession(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    typeof navigator.mediaSession.setActionHandler === "function"
  );
}

function register(
  action: MediaSessionAction,
  handler: ActionHandler,
): boolean {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
    return true;
  } catch {
    // Some webviews expose only a subset of actions.
    return false;
  }
}

function unregister(action: MediaSessionAction): void {
  try {
    navigator.mediaSession.setActionHandler(action, null);
  } catch {
    // Ignore unsupported actions during cleanup.
  }
}

/**
 * Keep lock-screen, headphone and OS media controls in sync with the player.
 * The transport handlers use the store directly so they keep working while the
 * player is collapsed or the route changes.
 */
export function useMediaSession(item: QueueItem | null | undefined) {
  const playing = usePlayerStore((state) => state.playing);

  useEffect(() => {
    if (!hasMediaSession()) return;
    const registered: MediaSessionAction[] = [];
    const add = (action: MediaSessionAction, handler: ActionHandler) => {
      if (register(action, handler)) registered.push(action);
    };

    add("play", () => usePlayerStore.getState().setPlaying(true));
    add("pause", () => usePlayerStore.getState().setPlaying(false));
    add("previoustrack", () => usePlayerStore.getState().previous());
    add("nexttrack", () => usePlayerStore.getState().next());
    add("stop", () => usePlayerStore.getState().clear());
    add("seekbackward", (details) => {
      const state = usePlayerStore.getState();
      state.seek(Math.max(0, state.currentTime - (details.seekOffset ?? 10)));
    });
    add("seekforward", (details) => {
      const state = usePlayerStore.getState();
      state.seek(state.currentTime + (details.seekOffset ?? 10));
    });
    add("seekto", (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        usePlayerStore.getState().seek(details.seekTime);
      }
    });

    return () => {
      for (const action of registered) unregister(action);
    };
  }, []);

  useEffect(() => {
    if (!hasMediaSession()) return;
    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch {
      // Playback state is optional.
    }
  }, [playing]);

  useEffect(() => {
    if (!item || !hasMediaSession()) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || item.fileName,
        artist: item.creatorName,
        album: "Pawchive",
        artwork: item.artwork ? [{ src: item.artwork }] : [],
      });
    } catch {
      // Media Session is optional.
    }
  }, [item]);
}
