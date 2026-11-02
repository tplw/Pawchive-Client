import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import type { QueueItem } from "../types";
import { Player } from "./Player";
import { clearProgressCache } from "./progress";
import { usePlayerStore } from "./store";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../services/api", () => ({
  api: {
    validateMedia: vi.fn(),
    getProgress: vi.fn(),
    saveProgress: vi.fn(),
    readSubtitle: vi.fn(),
    openExternal: vi.fn(),
  },
}));

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

describe("player", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProgressCache();
    useAppStore.setState({ toasts: [] });
    usePlayerStore.setState({
      queue: [item],
      currentId: item.id,
      playing: true,
      volume: 1,
      muted: false,
      speed: 1,
      expanded: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
    });
    vi.mocked(api.validateMedia).mockResolvedValue(item.url);
    vi.mocked(api.getProgress).mockResolvedValue({
      filePath: item.filePath,
      position: 30,
      duration: 120,
      updatedAt: 1700000000,
    });
    vi.mocked(api.saveProgress).mockResolvedValue(undefined);
  });

  it("saves progress before navigating to another page", async () => {
    render(<Player />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 42,
    });
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    window.dispatchEvent(new Event("pawchive:save-progress"));
    await waitFor(() =>
      expect(api.saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "aa/bb/clip.mp4",
          position: 42,
          duration: 120,
        }),
      ),
    );
  });

  it("restores the last playback position after metadata loads", async () => {
    render(<Player />);
    await waitFor(() =>
      expect(api.getProgress).toHaveBeenCalledWith("aa/bb/clip.mp4"),
    );
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    fireEvent.loadedMetadata(video as HTMLVideoElement);
    await waitFor(() =>
      expect((video as HTMLVideoElement).currentTime).toBeCloseTo(30, 1),
    );
  });
});
