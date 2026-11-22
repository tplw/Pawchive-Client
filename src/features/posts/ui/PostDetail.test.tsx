import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import { saveCreatorFilter } from "../../../shared/lib/creatorFilters";
import { useAppStore } from "../../../app/store";
import { wireNavigation } from "../../../app/bootstrap/wireNavigation";
import { usePlayerStore } from "../../player/model/store";
import { PostDetailPage } from "./PostDetail";
import { clearPostFeeds, rememberPostFeed } from "../model/postNavigation";
import type {
  Attachment,
  PostDetail,
  PostSummary,
  QueueItem,
} from "../../../shared/types";

vi.mock("../../../shared/api", () => ({
  api: {
    getPost: vi.fn(),
    resolvePostAttachments: vi.fn(),
    getPostComments: vi.fn(),
    getPostRevisions: vi.fn(),
    getMediaSize: vi.fn(),
    getImageDimensions: vi.fn(),
    resolveMedia: vi.fn(),
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
    usePlayerStore.setState({
      queue: [],
      currentId: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
    });
    vi.mocked(api.getPostComments).mockResolvedValue([]);
    vi.mocked(api.getPostRevisions).mockResolvedValue([]);
    vi.mocked(api.getMediaSize).mockResolvedValue(null);
    vi.mocked(api.getImageDimensions).mockResolvedValue(null);
    vi.mocked(api.resolvePostAttachments).mockResolvedValue([]);
    vi.mocked(api.resolveMedia).mockResolvedValue(null as never);
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

  it("hides the source tag when configured", async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, hideSourceTags: true },
    });
    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    expect(await screen.findByText("Detailed post")).toBeInTheDocument();
    expect(
      screen.queryByText("Pixiv Fanbox", { selector: "span" }),
    ).not.toBeInTheDocument();
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
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

  it("renders fast attachments and resolves provider metadata in the background", async () => {
    const url = "https://mega.nz/#P!protected";
    const fastAttachment = {
      name: "mega-link",
      path: url,
      url,
      downloadUrl: url,
      thumbnailUrl: null,
      kind: "other" as const,
      provider: "mega" as const,
      ext: "",
      previewOnly: false,
      locked: false,
      resolving: true,
    };
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Provider post",
        content: "<p>Fast content</p>",
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
      attachments: [fastAttachment],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: null,
      prev: null,
    } as unknown as PostDetail);
    let finish!: (attachments: Attachment[]) => void;
    vi.mocked(api.resolvePostAttachments).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    expect(await screen.findByText("Fast content")).toBeInTheDocument();
    expect(await screen.findByText("mega-link")).toBeInTheDocument();
    expect(screen.getByText("loading provider info…")).toBeInTheDocument();
    expect(api.resolvePostAttachments).toHaveBeenCalledWith([fastAttachment]);

    await act(async () => {
      finish([{ ...fastAttachment, name: "resolved.mp4", kind: "video", resolving: false }]);
    });
    expect(await screen.findByText("resolved.mp4")).toBeInTheDocument();
    expect(screen.queryByText("loading provider info…")).not.toBeInTheDocument();
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

  it("starts comic mode from a per-creator override", async () => {
    saveCreatorFilter("fanbox", "7", {
      audioOnly: false,
      mediaFilter: "all",
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      autoComicMode: true,
      keywords: [],
    });
    const creatorRoute = {
      name: "creator" as const,
      service: "fanbox",
      creatorId: "7",
    };
    const postRoute = {
      name: "post" as const,
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute, postRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: postRoute,
      previousRoute: creatorRoute,
      tabs,
      settings: { ...DEFAULT_SETTINGS, comicAutoEnable: false },
    });
    const summary = (id: string): PostSummary =>
      ({
        id,
        service: "fanbox",
        user: "7",
        creatorName: "Grace Hopper",
        title: id,
        excerpt: "",
        published: 1,
        added: 1,
        thumbnailUrl: null,
        attachmentCount: 1,
        mediaKinds: ["image"],
        previewState: null,
        hasFull: null,
        imported: true,
        exceedsLimit: false,
        unavailable: false,
      }) as PostSummary;
    rememberPostFeed({
      service: "fanbox",
      creatorId: "7",
      visible: [summary("99"), summary("100")],
      all: [summary("99"), summary("100")],
      hasMore: false,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    const image = await screen.findByText("image.jpg");
    fireEvent.click(image.closest("button")!);

    expect(
      await screen.findByRole("button", { name: "Comic mode on" }),
    ).toBeInTheDocument();

    fetchSpy.mockRestore();
    clearPostFeeds();
    window.localStorage.removeItem("pawchive-creator-filter:fanbox:7");
    useAppStore.setState({
      route: { name: "discover" },
      previousRoute: null,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("loads the previous post from the first comic image", async () => {
    const creatorRoute = {
      name: "creator" as const,
      service: "fanbox",
      creatorId: "7",
    };
    const postRoute = {
      name: "post" as const,
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute, postRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: postRoute,
      previousRoute: creatorRoute,
      tabs,
    });
    const summary = (id: string): PostSummary =>
      ({
        id,
        service: "fanbox",
        user: "7",
        creatorName: "Grace Hopper",
        title: id,
        excerpt: "",
        published: 1,
        added: 1,
        thumbnailUrl: null,
        attachmentCount: 1,
        mediaKinds: ["image"],
        previewState: null,
        hasFull: null,
        imported: true,
        exceedsLimit: false,
        unavailable: false,
      }) as PostSummary;
    rememberPostFeed({
      service: "fanbox",
      creatorId: "7",
      visible: [summary("100"), summary("99"), summary("101")],
      all: [summary("100"), summary("99"), summary("101")],
      hasMore: false,
    });
    const previousDetail = {
      post: {
        id: "100",
        user: "7",
        service: "fanbox",
        title: "Newer post",
        content: "",
        embed: {},
        shared_file: false,
        added: 1700000000,
        published: 1700000000,
        edited: null,
        file: null,
        attachments: [],
        next: "99",
        prev: null,
      },
      attachments: [
        {
          name: "100.png",
          path: "/aa/bb/100.png",
          url: "https://file.pawchive.pw/data/aa/bb/100.png",
          downloadUrl: "https://file.pawchive.pw/data/aa/bb/100.png",
          thumbnailUrl:
            "https://img.pawchive.pw/thumbnail/data/aa/bb/100.png",
          kind: "image",
          provider: "pawchive",
          ext: "png",
          previewOnly: false,
        },
      ],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: "99",
      prev: null,
    } as unknown as PostDetail;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    const image = await screen.findByText("image.jpg");
    fireEvent.click(image.closest("button")!);
    const viewer = await screen.findByRole("dialog", {
      name: "Image viewer",
    });
    expect(
      within(viewer).getByRole("button", { name: "Previous post" }),
    ).toBeInTheDocument();

    vi.mocked(api.getPost).mockResolvedValueOnce(previousDetail);
    fireEvent.click(
      within(viewer).getByRole("button", { name: "Previous post" }),
    );

    expect(await screen.findByText("100.png")).toBeInTheDocument();
    expect(api.getPost).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "fanbox",
        creatorId: "7",
        postId: "100",
      }),
    );

    fetchSpy.mockRestore();
    clearPostFeeds();
    useAppStore.setState({
      route: { name: "discover" },
      previousRoute: null,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("does not append the same prefetched post twice", async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, comicPrefetchCount: 5 },
    });
    const creatorRoute = {
      name: "creator" as const,
      service: "fanbox",
      creatorId: "7",
    };
    const postRoute = {
      name: "post" as const,
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute, postRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: postRoute,
      previousRoute: creatorRoute,
      tabs,
    });
    const summary = (id: string): PostSummary =>
      ({
        id,
        service: "fanbox",
        user: "7",
        creatorName: "Grace Hopper",
        title: id,
        excerpt: "",
        published: 1,
        added: 1,
        thumbnailUrl: null,
        attachmentCount: 1,
        mediaKinds: ["image"],
        previewState: null,
        hasFull: null,
        imported: true,
        exceedsLimit: false,
        unavailable: false,
      }) as PostSummary;
    rememberPostFeed({
      service: "fanbox",
      creatorId: "7",
      visible: [summary("100"), summary("99"), summary("101")],
      all: [summary("100"), summary("99"), summary("101")],
      hasMore: false,
    });
    const detailFor = (id: string, imageName: string): PostDetail =>
      ({
        post: {
          id,
          user: "7",
          service: "fanbox",
          title: `Post ${id}`,
          content: "",
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
            name: imageName,
            path: `/aa/bb/${imageName}`,
            url: `https://file.pawchive.pw/data/aa/bb/${imageName}`,
            downloadUrl: `https://file.pawchive.pw/data/aa/bb/${imageName}`,
            thumbnailUrl: `https://img.pawchive.pw/thumbnail/data/aa/bb/${imageName}`,
            kind: "image",
            provider: "pawchive",
            ext: "png",
            previewOnly: false,
          },
        ],
        creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
        next: null,
        prev: null,
      }) as PostDetail;
    vi.mocked(api.getPost).mockImplementation(async ({ postId }) =>
      postId === "101" ? detailFor("101", "101.png") : detailFor("99", "99.png"),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    const image = await screen.findByText("99.png");
    fireEvent.click(image.closest("button")!);
    const viewer = await screen.findByRole("dialog", {
      name: "Image viewer",
    });

    expect(await within(viewer).findByText("1 / 2")).toBeInTheDocument();
    expect(within(viewer).queryByText("1 / 3")).not.toBeInTheDocument();

    fireEvent.click(
      within(viewer).getByRole("button", { name: "Next image" }),
    );
    expect(await within(viewer).findByText("101.png")).toBeInTheDocument();

    fetchSpy.mockRestore();
    clearPostFeeds();
    useAppStore.setState({
      route: { name: "discover" },
      previousRoute: null,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("prefetches newer posts after moving toward them", async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, comicPrefetchCount: 5 },
    });
    const creatorRoute = {
      name: "creator" as const,
      service: "fanbox",
      creatorId: "7",
    };
    const postRoute = {
      name: "post" as const,
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute, postRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: postRoute,
      previousRoute: creatorRoute,
      tabs,
    });
    const ids = ["102", "101", "100", "99", "98"];
    const summary = (id: string): PostSummary =>
      ({
        id,
        service: "fanbox",
        user: "7",
        creatorName: "Grace Hopper",
        title: id,
        excerpt: "",
        published: 1,
        added: 1,
        thumbnailUrl: null,
        attachmentCount: 1,
        mediaKinds: ["image"],
        previewState: null,
        hasFull: null,
        imported: true,
        exceedsLimit: false,
        unavailable: false,
      }) as PostSummary;
    rememberPostFeed({
      service: "fanbox",
      creatorId: "7",
      visible: ids.map(summary),
      all: ids.map(summary),
      hasMore: false,
    });
    const detailFor = (id: string): PostDetail =>
      ({
        post: {
          id,
          user: "7",
          service: "fanbox",
          title: `Post ${id}`,
          content: "",
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
            name: `${id}.png`,
            path: `/aa/bb/${id}.png`,
            url: `https://file.pawchive.pw/data/aa/bb/${id}.png`,
            downloadUrl: `https://file.pawchive.pw/data/aa/bb/${id}.png`,
            thumbnailUrl: `https://img.pawchive.pw/thumbnail/data/aa/bb/${id}.png`,
            kind: "image",
            provider: "pawchive",
            ext: "png",
            previewOnly: false,
          },
        ],
        creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
        next: null,
        prev: null,
      }) as PostDetail;
    vi.mocked(api.getPost).mockImplementation(async ({ postId }) =>
      detailFor(postId),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    const image = await screen.findByText("99.png");
    fireEvent.click(image.closest("button")!);
    const viewer = await screen.findByRole("dialog", {
      name: "Image viewer",
    });
    const previousPost = within(viewer).getByRole("button", {
      name: "Previous post",
    });
    await waitFor(() => expect(previousPost).toBeEnabled());
    fireEvent.click(previousPost);

    expect(await within(viewer).findByText("3 / 5")).toBeInTheDocument();
    fireEvent.click(
      within(viewer).getByRole("button", { name: "Previous image" }),
    );
    expect(await within(viewer).findByText("101.png")).toBeInTheDocument();
    fireEvent.click(
      within(viewer).getByRole("button", { name: "Previous image" }),
    );
    expect(await within(viewer).findByText("102.png")).toBeInTheDocument();

    fetchSpy.mockRestore();
    clearPostFeeds();
    useAppStore.setState({
      route: { name: "discover" },
      previousRoute: null,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("keeps the existing queue when a single attachment is played", async () => {
    const existing: QueueItem = {
      id: "existing",
      url: "https://file.pawchive.pw/data/old/old.mp3",
      filePath: "/old/old.mp3",
      fileName: "old.mp3",
      mediaKind: "audio",
      title: "Old track",
      creatorName: "Ada",
      artwork: null,
      service: "patreon",
      creatorId: "1",
      postId: "2",
    };
    usePlayerStore.setState({
      queue: [existing],
      currentId: existing.id,
      playing: false,
      currentTime: 12,
      duration: 100,
      buffered: 0,
    });
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Queue post",
        content: "<p>Play this clip</p>",
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
          name: "clip.mp3",
          path: "/aa/bb/clip.mp3",
          url: "https://file.pawchive.pw/data/aa/bb/clip.mp3",
          downloadUrl: "https://file.pawchive.pw/data/aa/bb/clip.mp3",
          thumbnailUrl: null,
          kind: "audio",
          provider: "pawchive",
          ext: "mp3",
          previewOnly: false,
        },
      ],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: null,
      prev: null,
    } as PostDetail);

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    const name = await screen.findByText("clip.mp3");
    fireEvent.click(name.closest("button")!);

    await waitFor(() =>
      expect(usePlayerStore.getState().currentId).not.toBe(existing.id),
    );
    expect(
      usePlayerStore.getState().queue.map((entry) => entry.fileName),
    ).toEqual(["old.mp3", "clip.mp3"]);
  });

  it("keeps the existing queue when Play media is used", async () => {
    const existing: QueueItem = {
      id: "existing",
      url: "https://file.pawchive.pw/data/old/old.mp3",
      filePath: "/old/old.mp3",
      fileName: "old.mp3",
      mediaKind: "audio",
      title: "Old track",
      creatorName: "Ada",
      artwork: null,
      service: "patreon",
      creatorId: "1",
      postId: "2",
    };
    usePlayerStore.setState({
      queue: [existing],
      currentId: existing.id,
      playing: false,
      currentTime: 12,
      duration: 100,
      buffered: 0,
    });
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Queue post",
        content: "<p>Play this clip</p>",
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
          name: "clip.mp3",
          path: "/aa/bb/clip.mp3",
          url: "https://file.pawchive.pw/data/aa/bb/clip.mp3",
          downloadUrl: "https://file.pawchive.pw/data/aa/bb/clip.mp3",
          thumbnailUrl: null,
          kind: "audio",
          provider: "pawchive",
          ext: "mp3",
          previewOnly: false,
        },
      ],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: null,
      prev: null,
    } as PostDetail);

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Play media" }),
    );

    await waitFor(() =>
      expect(usePlayerStore.getState().queue).toHaveLength(2),
    );
    expect(
      usePlayerStore.getState().queue.map((entry) => entry.fileName),
    ).toEqual(["old.mp3", "clip.mp3"]);
  });

  it("keeps the creator context when moving to the next post", async () => {
    const creatorRoute = {
      name: "creator" as const,
      service: "fanbox",
      creatorId: "7",
    };
    const postRoute = {
      name: "post" as const,
      service: "fanbox",
      creatorId: "7",
      postId: "99",
    };
    wireNavigation();
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute, postRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: postRoute,
      previousRoute: creatorRoute,
      tabs,
    });
    vi.mocked(api.getPost).mockResolvedValue({
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Post 99",
        content: "<p>First</p>",
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
      attachments: [],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: "100",
      prev: null,
    } as PostDetail);

    wrapper(<PostDetailPage service="fanbox" creatorId="7" postId="99" />);
    fireEvent.click(await screen.findByRole("button", { name: "Next post" }));

    await waitFor(() =>
      expect(useAppStore.getState().route).toMatchObject({ postId: "100" }),
    );
    expect(useAppStore.getState().previousRoute).toEqual(creatorRoute);
    useAppStore.setState({
      route: { name: "discover" },
      previousRoute: null,
      activeTab: "discover",
    });
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
