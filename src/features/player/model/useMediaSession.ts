import { useEffect } from "react";
import type { QueueItem } from "../../../shared/types";

/** Keep the OS media controls in sync with the current queue item. */
export function useMediaSession(item: QueueItem | null | undefined) {
  useEffect(() => {
    if (!item || typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
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
