import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import type { DownloadRecord } from "../../../shared/types";
import { DownloadsPage } from "./Downloads";

vi.mock("../../../shared/api", () => ({
  api: {
    listDownloads: vi.fn(),
    localMediaUrl: vi.fn(),
    openDownloadsFolder: vi.fn(),
    clearCompletedDownloads: vi.fn(),
    clearAllDownloads: vi.fn(),
    listCreators: vi.fn(),
    getCreatorPosts: vi.fn(),
    downloadCreatorPosts: vi.fn(),
  },
}));

function record(overrides: Partial<DownloadRecord>): DownloadRecord {
  return {
    id: "a",
    url: "https://file.pawchive.pw/data/aa/bb/clip.mp4",
    filePath: "/tmp/clip.mp4",
    fileName: "clip.mp4",
    mediaKind: "video",
    title: "Active video",
    creatorName: "Ada",
    service: "patreon",
    creatorId: "1",
    postId: "2",
    playlistId: null,
    thumbnailUrl: null,
    totalBytes: 100,
    downloadedBytes: 50,
    status: "downloading",
    error: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("downloads page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      toasts: [],
    });
    vi.mocked(api.listDownloads).mockResolvedValue([
      record({ id: "active", title: "Active video", createdAt: 3 }),
      record({
        id: "done",
        title: "Done audio",
        mediaKind: "audio",
        fileName: "done.mp3",
        status: "completed",
        downloadedBytes: 100,
        createdAt: 2,
      }),
      record({
        id: "failed",
        title: "Failed file",
        mediaKind: "document",
        fileName: "failed.pdf",
        status: "failed",
        error: "expired",
        createdAt: 1,
      }),
    ]);
    vi.mocked(api.localMediaUrl).mockResolvedValue("http://127.0.0.1/media");
    vi.mocked(api.openDownloadsFolder).mockResolvedValue(undefined);
    vi.mocked(api.clearCompletedDownloads).mockResolvedValue(1);
    vi.mocked(api.clearAllDownloads).mockResolvedValue(3);
    vi.mocked(api.listCreators).mockResolvedValue({
      items: [
        {
          id: "42",
          name: "Ada",
          service: "patreon",
          public_id: "ada",
          indexed: 1,
          updated: 2,
          favorited: 10,
          is_favorite: false,
          ever_imported: true,
        },
      ],
      offset: 0,
      total: 1,
      hasMore: false,
      synced: true,
    });
    vi.mocked(api.getCreatorPosts).mockResolvedValue({
      items: [],
      offset: 0,
      hasMore: false,
    });
    vi.mocked(api.downloadCreatorPosts).mockResolvedValue({
      posts: 0,
      queued: 0,
      skipped: 0,
      locked: 0,
      failed: 0,
    });
  });

  it("shows stats and filters by search and status", async () => {
    wrapper(<DownloadsPage />);

    expect(await screen.findByText("Active video")).toBeInTheDocument();
    expect(screen.getByText("Done audio")).toBeInTheDocument();
    expect(screen.getByText("Failed file")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("Search downloads…"), {
      target: { value: "done" },
    });
    expect(screen.getByText("Done audio")).toBeInTheDocument();
    expect(screen.queryByText("Active video")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed file")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search downloads…"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Completed 1" }));
    expect(screen.getByText("Done audio")).toBeInTheDocument();
    expect(screen.queryByText("Active video")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed file")).not.toBeInTheDocument();
  });

  it("opens the creator download dialog", async () => {
    wrapper(<DownloadsPage />);
    await screen.findByText("Active video");

    fireEvent.click(screen.getByRole("button", { name: "Choose creator" }));

    await waitFor(() =>
      expect(screen.getByText("Download from creator")).toBeInTheDocument(),
    );
    expect(
      screen.getByPlaceholderText("Search creators by name…"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
  });
});
