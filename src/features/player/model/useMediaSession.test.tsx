import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../../../shared/types";
import { useMediaSession } from "./useMediaSession";
import { usePlayerStore } from "./store";

const item: QueueItem = {
  id: "patreon:1:2:/aa/bb/clip.mp4",
  url: "https://file.pawchive.pw/data/aa/bb/clip.mp4",
  filePath: "/aa/bb/clip.mp4",
  fileName: "clip.mp4",
  mediaKind: "video",
  title: "A video",
  creatorName: "Ada",
  artwork: null,
  service: "patreon",
  creatorId: "1",
  postId: "2",
};

const nextItem: QueueItem = {
  ...item,
  id: "patreon:1:3:/cc/dd/next.mp4",
  filePath: "/cc/dd/next.mp4",
  fileName: "next.mp4",
  title: "Next video",
};

describe("media session controls", () => {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  let originalMediaSession: PropertyDescriptor | undefined;

  beforeEach(() => {
    handlers.clear();
    originalMediaSession = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        metadata: null,
        playbackState: "none",
        setActionHandler: (
          action: MediaSessionAction,
          handler: MediaSessionActionHandler | null,
        ) => {
          handlers.set(action, handler);
        },
      },
    });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: MediaMetadataInit) {}
      },
    );
    usePlayerStore.setState({
      queue: [item, nextItem],
      currentId: item.id,
      playing: true,
      currentTime: 50,
      duration: 120,
      buffered: 0,
      expanded: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalMediaSession) {
      Object.defineProperty(navigator, "mediaSession", originalMediaSession);
    }
  });

  it("maps next, previous and seek actions to the player store", () => {
    const { unmount } = renderHook(() => useMediaSession(item));

    expect(handlers.has("nexttrack")).toBe(true);
    expect(handlers.has("previoustrack")).toBe(true);

    handlers.get("nexttrack")?.({ action: "nexttrack" });
    expect(usePlayerStore.getState().currentId).toBe(nextItem.id);

    usePlayerStore.setState({ currentTime: 50, duration: 120 });
    handlers.get("seekforward")?.({ action: "seekforward", seekOffset: 10 });
    expect(usePlayerStore.getState().currentTime).toBe(60);

    handlers.get("seekto")?.({ action: "seekto", seekTime: 25 });
    expect(usePlayerStore.getState().currentTime).toBe(25);

    unmount();
    expect(handlers.get("nexttrack")).toBeNull();
  });

  it("updates the OS playback state", () => {
    const { rerender } = renderHook(() => useMediaSession(item));
    const session = navigator.mediaSession as MediaSession;
    expect(session.playbackState).toBe("playing");

    usePlayerStore.setState({ playing: false });
    rerender();
    expect(session.playbackState).toBe("paused");
  });
});
