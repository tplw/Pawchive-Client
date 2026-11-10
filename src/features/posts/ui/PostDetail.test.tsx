import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { PostDetailPage } from "./PostDetail";
import { clearPostFeeds, rememberPostFeed } from "../model/postNavigation";
import type { PostDetail, PostSummary } from "../../../shared/types";

vi.mock("../../../shared/api", () => ({
  api: {
    getPost: vi.fn(),
    getPostComments: vi.fn(),
    getPostRevisions: vi.fn(),
    getMediaSize: vi.fn(),
    getImageDimensions: vi.fn(),
    openExternal: vi.fn(),
  },
}));

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("post detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPostComments).mockResolvedValue([]);
    vi.mocked(api.getPostRevisions).mockResolvedValue([]);
    vi.mocked(api.getMediaSize).mockResolvedValue(null);
    vi.mocked(api.getImageDimensions).mockResolvedValue(null);
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Detailed post",
        content: "<p>Hello <strong>archive</strong></p>",
        embed: {},
        shared_file: false,
        added: 1700000000,
        published: 1700000000,
        edited: null,
        file: null,
        attachments: [],
        next: null,
        prev: null,
      },
      attachments: [
        {
          name: "image.jpg",
          path: "/aa/bb/image.jpg",
          url: "https://file.pawchive.pw/data/aa/bb/image.jpg",
          thumbnailUrl:
            "https://img.pawchive.pw/thumbnail/data/aa/bb/image.jpg",
          kind: "image",
          provider: "pawchive",
          ext: "jpg",
          previewOnly: false,
        },
      ],
      creator: {
        id: "7",
        name: "Grace Hopper",
        service: "fanbox",
        public_id: "grace",
        indexed: 1700000000,
        updated: 1700000000,
        favorited: 12,
      },
      next: null,
      prev: null,
    });
  });

  it("renders post content, creator and attachments", async () => {
    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    expect(await screen.findByText("Detailed post")).toBeInTheDocument();
    expect(screen.getAllByText("Grace Hopper").length).toBeGreaterThan(0);
    expect(screen.getByText("image.jpg")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
  });

  it("explains how to import a post the archive does not have", async () => {
    vi.mocked(api.getPost).mockRejectedValue({
      code: "not_found",
      message: "remote content was not found",
      retryable: false,
    });
    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    expect(
      await screen.findByText("This post hasn't been archived yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open importer" }),
    ).toBeInTheDocument();
  });

  it("warns when files exceeded the archive size limit", async () => {
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Size-limited post",
        content: "<p>Partial archive</p>",
        embed: {},
        shared_file: false,
        added: 1700000000,
        published: 1700000000,
        edited: null,
        file: null,
        attachments: [],
        next: null,
        prev: null,
        origin: "import",
        has_full: false,
      },
      attachments: [],
      creator: {
        id: "7",
        name: "Grace Hopper",
        service: "fanbox",
        public_id: "grace",
        indexed: 1700000000,
        updated: 1700000000,
        favorited: 12,
      },
      next: null,
      prev: null,
    });
    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    expect(
      await screen.findByText(
        "Some files exceed the archive size limit and weren't saved",
      ),
    ).toBeInTheDocument();
  });

  it("skips posts hidden by the creator filter when navigating", async () => {
    clearPostFeeds();
    const summary = (id: string): PostSummary =>
      ({ id, service: "fanbox", user: "7", title: id }) as PostSummary;
    rememberPostFeed({
      service: "fanbox",
      creatorId: "7",
      visible: [summary("99"), summary("101")],
      all: [summary("99"), summary("100"), summary("101")],
      hasMore: false,
    });
    const detail = {
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Filtered post",
        content: "",
        embed: {},
        attachments: [],
        file: null,
        added: 1700000000,
        published: 1700000000,
        edited: null,
        shared_file: false,
        next: "100",
        prev: null,
      },
      attachments: [],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: "100",
      prev: null,
    } as unknown as PostDetail;
    vi.mocked(api.getPost).mockResolvedValue(detail);

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    fireEvent.click(await screen.findByRole("button", { name: "Next post" }));
    expect(window.location.hash).toBe("#/post/fanbox/7/101");
    clearPostFeeds();
  });
});
