import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import { loadCreatorFilter } from "../../../shared/lib/creatorFilters";
import { useAppStore } from "../../../app/store";
import type { CreatorSummary, PostSummary } from "../../../shared/types";
import { CreatorProfilePage } from "./CreatorProfile";

vi.mock("../../../shared/api", () => ({
  api: {
    getCreator: vi.fn(),
    getCreatorProfile: vi.fn(),
    getCreatorLinks: vi.fn(),
    getCreatorAnnouncements: vi.fn(),
    getCreatorPosts: vi.fn(),
    getSimilarCreators: vi.fn(),
    setFavoriteCreator: vi.fn(),
  },
}));

const creator: CreatorSummary = {
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

const post: PostSummary = {
  id: "1",
  service: "patreon",
  user: "42",
  creatorName: "Ada",
  title: "First post",
  excerpt: "",
  published: 1,
  added: 1,
  thumbnailUrl: null,
  attachmentCount: 0,
  mediaKinds: [],
  previewState: null,
  hasFull: null,
  imported: true,
  exceedsLimit: false,
  unavailable: false,
};

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("creator profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      route: { name: "creator" },
      previousRoute: null,
      settings: DEFAULT_SETTINGS,
    });
    vi.mocked(api.getCreator).mockResolvedValue(creator);
    vi.mocked(api.getCreatorProfile).mockResolvedValue({
      ...creator,
      description: "An artist",
    });
    vi.mocked(api.getCreatorLinks).mockResolvedValue([]);
    vi.mocked(api.getCreatorAnnouncements).mockResolvedValue([]);
    vi.mocked(api.getCreatorPosts).mockResolvedValue({
      items: [post],
      offset: 0,
      hasMore: false,
    });
    vi.mocked(api.getSimilarCreators).mockResolvedValue([
      {
        id: "99",
        name: "Grace",
        service: "patreon",
        favorited: 5,
        is_favorite: false,
      },
    ]);
  });

  it("persists auto-detected ASMR for creator previews", async () => {
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
    vi.mocked(api.getCreatorPosts).mockResolvedValue({
      items: [{ ...post, title: "ASMR whisper session" }],
      offset: 0,
      hasMore: false,
    });

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    await waitFor(() =>
      expect(loadCreatorFilter("patreon", "42").asmr).toBe(true),
    );
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
  });

  it("searches this creator's posts", async () => {
    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    expect(await screen.findByText("First post")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search this creator's posts"), {
      target: { value: "second" },
    });

    await waitFor(() =>
      expect(api.getCreatorPosts).toHaveBeenLastCalledWith(
        expect.objectContaining({ service: "patreon", creatorId: "42", query: "second" }),
      ),
    );
  });

  it("loads similar creators from the recommended page", async () => {
    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    fireEvent.click(await screen.findByRole("button", { name: "Similar Creators" }));

    expect(await screen.findByText("Grace")).toBeInTheDocument();
    expect(api.getSimilarCreators).toHaveBeenCalledWith(
      "patreon",
      "42",
      expect.anything(),
    );
  });

  it("marks creators the archive has not imported", async () => {
    vi.mocked(api.getCreator).mockResolvedValue({
      ...creator,
      ever_imported: false,
    });
    vi.mocked(api.getCreatorProfile).mockResolvedValue({
      ...creator,
      description: "An artist",
      ever_imported: false,
    });
    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    expect(
      await screen.findByTitle("haven't imported this creator yet"),
    ).toBeInTheDocument();
  });

  it("hides unimported creators from similar creators when unavailable posts are hidden", async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, hideUnavailablePosts: true },
    });
    vi.mocked(api.getSimilarCreators).mockResolvedValue([
      {
        id: "98",
        name: "Imported Artist",
        service: "patreon",
        ever_imported: true,
      },
      {
        id: "99",
        name: "Unimported Artist",
        service: "patreon",
        ever_imported: false,
      },
    ]);

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    fireEvent.click(await screen.findByRole("button", { name: "Similar Creators" }));

    expect(await screen.findByText("Imported Artist")).toBeInTheDocument();
    expect(screen.queryByText("Unimported Artist")).not.toBeInTheDocument();
  });
});
