import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { HomePage } from "./Home";

vi.mock("../services/api", () => ({
  api: {
    listPlaylists: vi.fn(),
    listFavoriteCreators: vi.fn(),
    listPlaylistItems: vi.fn(),
    downloadPlaylist: vi.fn(),
    setFavoriteCreator: vi.fn(),
  },
}));

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPlaylists).mockResolvedValue([
      {
        id: 1,
        name: "Watch later",
        description: "Clips",
        itemCount: 2,
        coverUrl: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    vi.mocked(api.listFavoriteCreators).mockResolvedValue([
      {
        id: "42",
        name: "Ada Lovelace",
        service: "patreon",
        public_id: "ada",
        favorited: 12,
        is_favorite: true,
      },
    ]);
  });

  it("shows playlists and favorite creators", async () => {
    wrapper(<HomePage />);
    expect(await screen.findByText("Watch later")).toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Your playlists")).toBeInTheDocument();
  });
});
