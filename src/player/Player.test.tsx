import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    setStatusBarHidden: vi.fn().mockResolvedValue(undefined),
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
    useAppStore.setState({
      toasts: [],
      route: { name: "home" },
      previousRoute: null,
    });
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

  it("forces playback when the media element is paused but the UI says playing", () => {
    render(<Player />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: true,
    });
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(play).toHaveBeenCalled();
  });

  it("shows the buffering animation beside the media time", async () => {
    usePlayerStore.setState({ expanded: true });
    render(<Player />);
    const spinner = await screen.findByRole("status", { name: "Buffering" });
    const time = screen.getByText(/0:00 \/ 0:00/);
    expect(time.parentElement).toContainElement(spinner);
    expect(
      time.compareDocumentPosition(spinner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the original post from the compact player title", () => {
    window.location.hash = "#/home";
    render(<Player />);
    fireEvent.click(screen.getByTitle("Open original post"));
    expect(window.location.hash).toBe("#/post/patreon/1/2");
  });

  it("minimizes the player and opens the post from the expanded title", () => {
    window.location.hash = "#/home";
    usePlayerStore.setState({ expanded: true });
    render(<Player />);
    fireEvent.click(screen.getByTitle("Open original post"));
    expect(window.location.hash).toBe("#/post/patreon/1/2");
    expect(usePlayerStore.getState().expanded).toBe(false);
  });

  it("expands the player when the compact thumbnail is clicked", () => {
    render(<Player />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    fireEvent.click(video);
    expect(usePlayerStore.getState().expanded).toBe(true);
  });

  it("hides and restores the player ui when the media is pressed", () => {
    usePlayerStore.setState({ expanded: true });
    render(<Player />);

    const toggle = screen.getByLabelText("Toggle player controls");
    expect(screen.getByTitle("Open original post")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByTitle("Open original post")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByTitle("Open original post")).toBeTruthy();
  });

  it("falls back to the direct download when HLS playback is unsupported", async () => {
    const hlsItem: QueueItem = {
      ...item,
      id: "patreon:1:2:/d/hash/clip.mp4",
      url: "https://t1.pawchive.pw/v/hash/master.m3u8?e=1&s=abc",
      downloadUrl: "https://t1.pawchive.pw/d/hash/clip.mp4?e=1&s=xyz",
      filePath: "/d/hash/clip.mp4",
    };
    usePlayerStore.setState({ queue: [hlsItem], currentId: hlsItem.id });
    vi.mocked(api.validateMedia).mockResolvedValue(hlsItem.url);

    render(<Player />);
    const video = document.querySelector("video") as HTMLVideoElement;
    await waitFor(() => expect(video.src).toBe(hlsItem.url));

    fireEvent.error(video);

    await waitFor(() => expect(video.src).toBe(hlsItem.downloadUrl));
  });

  it("shows the playing video instead of the artwork in the mini player", async () => {
    const artworkItem: QueueItem = {
      ...item,
      artwork: "https://img.pawchive.pw/thumbnail/data/aa/bb/cover.jpg",
    };
    usePlayerStore.setState({ queue: [artworkItem], currentId: artworkItem.id });
    vi.mocked(api.validateMedia).mockResolvedValue(artworkItem.url);

    render(<Player />);
    const video = document.querySelector("video") as HTMLVideoElement;
    const stage = video.parentElement as HTMLElement;
    expect(stage.querySelector("img")).not.toBeNull();

    await waitFor(() => expect(video.src).toBe(artworkItem.url));
    fireEvent.loadedData(video);
    expect(stage.querySelector("img")).toBeNull();
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
