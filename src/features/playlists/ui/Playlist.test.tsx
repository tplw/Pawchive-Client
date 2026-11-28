import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import type { Playlist, PlaylistItem } from "../../../shared/types";
import { PlaylistPage } from "./Playlist";

vi.mock("../../../shared/api", () => ({
  api: {
    getPlaylist: vi.fn(),
    listPlaylistItems: vi.fn(),
    listPlaylists: vi.fn(),
    reorderPlaylistItems: vi.fn(),
    removePlaylistItem: vi.fn(),
    deletePlaylist: vi.fn(),
    localMediaUrl: vi.fn(),
    startDownload: vi.fn(),
    downloadPlaylist: vi.fn(),
  },
}));

const playlist: Playlist = {
  id: 5,
  name: "Test playlist",
  description: "",
  itemCount: 3,
  coverUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

function item(
  id: number,
  title: string,
  localPath: string | null = null,
): PlaylistItem {
  return {
    id,
    playlistId: playlist.id,
    service: "patreon",
    creatorId: "1",
    postId: "10",
    mediaPath: `/aa/${title}.mp4`,
    mediaUrl: `https://file.pawchive.pw/data/aa/${title}.mp4`,
    title,
    creatorName: "Ada",
    thumbnailUrl: null,
    mediaKind: "video",
    addedAt: id,
    localPath,
  };
}

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("playlist page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ settings: DEFAULT_SETTINGS, toasts: [] });
    vi.mocked(api.getPlaylist).mockResolvedValue(playlist);
    vi.mocked(api.listPlaylistItems).mockResolvedValue([
      item(1, "First"),
      item(2, "Second", "/tmp/second.mp4"),
      item(3, "Third"),
    ]);
    vi.mocked(api.reorderPlaylistItems).mockResolvedValue(undefined);
    vi.mocked(api.removePlaylistItem).mockResolvedValue(undefined);
    vi.mocked(api.localMediaUrl).mockResolvedValue("http://127.0.0.1/media");
    vi.mocked(api.startDownload).mockResolvedValue({
      id: "download",
      url: "https://file.pawchive.pw/data/aa/First.mp4",
      filePath: "/tmp/First.mp4",
      fileName: "First.mp4",
      mediaKind: "video",
      title: "First",
      creatorName: "Ada",
      service: "patreon",
      creatorId: "1",
      postId: "10",
      playlistId: 5,
      thumbnailUrl: null,
      totalBytes: null,
      downloadedBytes: 0,
      status: "queued",
      error: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(api.downloadPlaylist).mockResolvedValue(0);
  });

  it("shows a downloaded check only for verified local files", async () => {
    wrapper(<PlaylistPage playlistId={5} />);

    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Downloaded")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Queue all" }),
    ).not.toBeInTheDocument();
  });

  it("reorders items from edit mode", async () => {
    wrapper(<PlaylistPage playlistId={5} />);
    expect(await screen.findByText("First")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    await waitFor(() =>
      expect(api.reorderPlaylistItems).toHaveBeenCalledWith(5, [2, 1, 3]),
    );
  });

  it("removes an item", async () => {
    wrapper(<PlaylistPage playlistId={5} />);
    expect(await screen.findByText("First")).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove from playlist" })[0],
    );

    await waitFor(() => expect(api.removePlaylistItem).toHaveBeenCalledWith(1));
  });
});
