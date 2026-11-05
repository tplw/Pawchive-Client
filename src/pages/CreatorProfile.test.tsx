import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import type { CreatorSummary, PostSummary } from "../types";
import { CreatorProfilePage } from "./CreatorProfile";

vi.mock("../services/api", () => ({
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
    useAppStore.setState({ route: { name: "creator" }, previousRoute: null });
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
});
