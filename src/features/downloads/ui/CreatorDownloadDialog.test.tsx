import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import type {
  CreatorPage,
  CreatorSummary,
  MediaKind,
  PostPage,
  PostSummary,
} from "../../../shared/types";
import { DOWNLOAD_SCHEDULES_KEY } from "../model/downloadSchedules";
import { CreatorDownloadDialog } from "./CreatorDownloadDialog";

vi.mock("../../../shared/api", () => ({
  api: {
    listCreators: vi.fn(),
    listFavoriteCreators: vi.fn(),
    getCreatorDownloadPosts: vi.fn(),
    downloadCreatorPosts: vi.fn(),
  },
}));

const creator = { service: "patreon", id: "42", name: "Ada" };

const creatorSummary: CreatorSummary = {
  id: "42",
  name: "Ada",
  service: "patreon",
  public_id: "ada",
  indexed: 1,
  updated: 2,
  favorited: 10,
  is_favorite: false,
  ever_imported: true,
};

function post(
  id: string,
  title: string,
  kind: MediaKind = "image",
): PostSummary {
  return {
    id,
    service: "patreon",
    user: "42",
    creatorName: "Ada",
    title,
    excerpt: "",
    published: 1_700_000_000,
    added: 1_700_000_000,
    thumbnailUrl: null,
    attachmentCount: 1,
    mediaKinds: [kind],
    previewState: null,
    hasFull: null,
    imported: true,
    exceedsLimit: false,
    unavailable: false,
  } as PostSummary;
}

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function page(items: PostSummary[]): PostPage {
  return { items, offset: 0, hasMore: false };
}

describe("creator download dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(DOWNLOAD_SCHEDULES_KEY);
    useAppStore.setState({ settings: DEFAULT_SETTINGS, toasts: [] });
    vi.mocked(api.listCreators).mockResolvedValue({
      items: [creatorSummary],
      offset: 0,
      total: 1,
      hasMore: false,
      synced: true,
    } satisfies CreatorPage);
    vi.mocked(api.listFavoriteCreators).mockResolvedValue([]);
    vi.mocked(api.getCreatorDownloadPosts).mockResolvedValue(
      page([post("1", "First post"), post("2", "Second post", "video")]),
    );
    vi.mocked(api.downloadCreatorPosts).mockResolvedValue({
      posts: 1,
      queued: 2,
      skipped: 0,
      locked: 0,
      failed: 0,
      folder: "Ada",
    });
  });

  it("scans and queues only the selected posts", async () => {
    const onClose = vi.fn();
    wrapper(
      <CreatorDownloadDialog
        open
        onClose={onClose}
        creator={creator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan posts" }));
    expect(
      await screen.findByText("2 of 2 posts selected"),
    ).toBeInTheDocument();

    const firstRow = screen.getByText("First post").closest("label");
    expect(firstRow).not.toBeNull();
    fireEvent.click(firstRow!);
    expect(screen.getByText("1 of 2 posts selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download 1 post" }));

    await waitFor(() =>
      expect(api.downloadCreatorPosts).toHaveBeenCalledWith({
        service: "patreon",
        creatorId: "42",
        postIds: ["2"],
        mediaKinds: ["image", "video", "audio"],
        skipExisting: true,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("applies blacklist words before selecting posts", async () => {
    vi.mocked(api.getCreatorDownloadPosts).mockResolvedValue(
      page([
        post("1", "First post"),
        post("2", "Spoiler page", "video"),
      ]),
    );
    wrapper(
      <CreatorDownloadDialog open onClose={() => undefined} creator={creator} />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: /Skip posts containing/i }),
      { target: { value: "spoiler" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan posts" }));

    expect(
      await screen.findByText("1 of 1 posts selected"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Spoiler page")).not.toBeInTheDocument();
  });

  it("selects a creator from the search step", async () => {
    wrapper(<CreatorDownloadDialog open onClose={() => undefined} />);

    fireEvent.click(await screen.findByText("Ada"));
    expect(screen.getByText("Scan posts")).toBeInTheDocument();
  });

  it("saves a daily schedule with the current creator and filters", () => {
    wrapper(
      <CreatorDownloadDialog open onClose={() => undefined} creator={creator} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText("Schedule recurring download")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("switch", { name: "Skip already downloaded" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    const stored = JSON.parse(
      window.localStorage.getItem(DOWNLOAD_SCHEDULES_KEY) ?? "[]",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].creator).toMatchObject({
      service: "patreon",
      id: "42",
      name: "Ada",
    });
    expect(stored[0].frequency).toBe("daily");
    expect(stored[0].time).toBe("09:00");
    expect(stored[0].filters.mediaKinds).toEqual([
      "image",
      "video",
      "audio",
    ]);
    expect(stored[0].filters.fromDate).toBe("");
    expect(stored[0].filters.skipExisting).toBe(false);
  });

  it("puts favorite creators before the rest of the search results", async () => {
    vi.mocked(api.listFavoriteCreators).mockResolvedValue([
      {
        ...creatorSummary,
        id: "1",
        name: "Favorite creator",
        public_id: "favorite",
        is_favorite: true,
      },
    ]);

    wrapper(<CreatorDownloadDialog open onClose={() => undefined} />);

    const favorite = await screen.findByText("Favorite creator");
    const other = await screen.findByText("Ada");
    expect(
      favorite.compareDocumentPosition(other) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
