import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import type { DownloadRecord } from "../../../shared/types";
import { DOWNLOAD_SCHEDULES_KEY } from "../model/downloadSchedules";
import { DownloadsPage } from "./Downloads";

vi.mock("../../../shared/api", () => ({
  api: {
    listDownloads: vi.fn(),
    localMediaUrl: vi.fn(),
    openDownloadsFolder: vi.fn(),
    clearCompletedDownloads: vi.fn(),
    clearAllDownloads: vi.fn(),
    retryDownload: vi.fn(),
    listCreators: vi.fn(),
    listFavoriteCreators: vi.fn(),
    getCreatorDownloadPosts: vi.fn(),
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
    window.localStorage.clear();
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
    vi.mocked(api.retryDownload).mockResolvedValue(record({}));
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
    vi.mocked(api.listFavoriteCreators).mockResolvedValue([]);
    vi.mocked(api.getCreatorDownloadPosts).mockResolvedValue({
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
      folder: "Ada",
    });
  });

  it("shows stats and filters by search and status", async () => {
    wrapper(<DownloadsPage />);

    expect(await screen.findByText("Active video")).toBeInTheDocument();
    expect(screen.getByText("Done audio")).toBeInTheDocument();
    expect(screen.getByText("Failed file")).toBeInTheDocument();

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

  it("shows scheduled creator downloads", async () => {
    window.localStorage.setItem(
      DOWNLOAD_SCHEDULES_KEY,
      JSON.stringify([
        {
          id: "scheduled",
          creator: { service: "patreon", id: "42", name: "Ada" },
          filters: {
            fromDate: "",
            toDate: "",
            maxPosts: 50,
            keywords: [],
            mediaKinds: ["image", "video", "audio"],
            skipUnavailable: false,
            skipExisting: true,
            order: "newest",
          },
          frequency: "daily",
          time: "09:00",
          weekday: 1,
          enabled: true,
          createdAt: Date.now(),
          lastRunAt: null,
          nextRunAt: Date.now() + 3_600_000,
        },
      ]),
    );

    wrapper(<DownloadsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Scheduled downloads" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Scheduled downloads",
    });
    expect(within(dialog).getByText("Ada")).toBeInTheDocument();
    expect(within(dialog).getByText(/Daily at 09:00/)).toBeInTheDocument();
  });

  it("retries all failed downloads and no longer shows Clear completed", async () => {
    wrapper(<DownloadsPage />);
    expect(await screen.findByText("Failed file")).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Clear completed" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));

    await waitFor(() =>
      expect(api.retryDownload).toHaveBeenCalledWith("failed"),
    );
  });

  it("explains that clearing downloads keeps the media files", async () => {
    wrapper(<DownloadsPage />);
    await screen.findByText("Active video");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(
      await screen.findByText(/Files already downloaded stay on disk/),
    ).toBeInTheDocument();
  });

  it("edits a scheduled creator download from its settings", async () => {
    window.localStorage.setItem(
      DOWNLOAD_SCHEDULES_KEY,
      JSON.stringify([
        {
          id: "scheduled",
          creator: { service: "patreon", id: "42", name: "Ada" },
          filters: {
            fromDate: "",
            toDate: "",
            maxPosts: 50,
            keywords: [],
            mediaKinds: ["image", "video", "audio"],
            skipUnavailable: false,
            skipExisting: true,
            order: "newest",
          },
          frequency: "daily",
          time: "09:00",
          weekday: 1,
          enabled: true,
          createdAt: Date.now(),
          lastRunAt: null,
          nextRunAt: Date.now() + 3_600_000,
        },
      ]),
    );

    wrapper(<DownloadsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Scheduled downloads" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Schedule settings" }),
    );

    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "18:30" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Skip already downloaded" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(DOWNLOAD_SCHEDULES_KEY) ?? "[]",
      );
      expect(stored[0].time).toBe("18:30");
      expect(stored[0].filters.skipExisting).toBe(false);
    });
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
