import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { SearchPage } from "./Search";

vi.mock("../../../shared/api", () => ({
  api: {
    searchAll: vi.fn(),
    listCreators: vi.fn(),
  },
}));

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("search page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires three characters before searching", () => {
    wrapper(<SearchPage query="ab" />);
    expect(
      screen.getByText("Start with at least three characters"),
    ).toBeInTheDocument();
    expect(api.searchAll).not.toHaveBeenCalled();
  });

  it("renders post results returned by the archive", async () => {
    vi.mocked(api.searchAll).mockResolvedValue({
      posts: [
        {
          id: "1",
          service: "patreon",
          user: "2",
          creatorName: "Ada",
          title: "Found post",
          excerpt: "A match",
          published: 1700000000,
          added: 1700000000,
          thumbnailUrl: null,
          attachmentCount: 1,
          mediaKinds: ["image"],
          previewState: null,
          hasFull: true,
          imported: true,
          exceedsLimit: false,
          unavailable: false,
        },
      ],
      creators: [],
      offset: 0,
      hasMore: false,
      query: "found",
      limitations: [],
    });
    wrapper(<SearchPage query="found" />);
    expect(await screen.findByText("Found post")).toBeInTheDocument();
    expect(api.searchAll).toHaveBeenCalledWith(
      expect.objectContaining({ query: "found", offset: 0 }),
    );
  });
});
