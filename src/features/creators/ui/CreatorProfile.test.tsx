import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import {
  loadCreatorFilter,
  saveCreatorFilter,
} from "../../../shared/lib/creatorFilters";
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
    saveSettings: vi.fn(),
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
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
    window.sessionStorage.clear();
    useAppStore.setState({
      route: { name: "creator" },
      previousRoute: null,
      activeTab: "discover",
      tabs: {
        home: { stack: [{ name: "home" }], index: 0 },
        discover: { stack: [{ name: "discover" }], index: 0 },
        search: { stack: [{ name: "search" }], index: 0 },
        downloads: { stack: [{ name: "downloads" }], index: 0 },
        settings: { stack: [{ name: "settings" }], index: 0 },
      },
      settings: DEFAULT_SETTINGS,
      toasts: [],
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
    vi.mocked(api.saveSettings).mockImplementation(async (patch) => ({
      ...DEFAULT_SETTINGS,
      ...patch,
    }));
  });

  it("asks for confirmation before blocking a creator", async () => {
    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);

    fireEvent.click(await screen.findByRole("button", { name: "Block" }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Block creator?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.saveSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Block creator" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          blockedCreators: expect.arrayContaining([
            expect.objectContaining({
              id: "42",
              name: "Ada",
              service: "patreon",
            }),
          ]),
        }),
      ),
    );
  });

  it("leaves the blocked creator context after blocking", async () => {
    const creatorRoute = {
      name: "creator" as const,
      service: "patreon",
      creatorId: "42",
    };
    const postRoute = {
      name: "post" as const,
      service: "patreon",
      creatorId: "42",
      postId: "1",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, postRoute, creatorRoute],
      index: 2,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: creatorRoute,
      previousRoute: postRoute,
      tabs,
    });

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    fireEvent.click(await screen.findByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Block creator" }));

    await waitFor(() =>
      expect(useAppStore.getState().route).toEqual({ name: "discover" }),
    );
    expect(screen.queryByText("Creator blocked")).not.toBeInTheDocument();
  });

  it("redirects away from a directly opened blocked creator", async () => {
    const creatorRoute = {
      name: "creator" as const,
      service: "patreon",
      creatorId: "42",
    };
    const tabs = structuredClone(useAppStore.getState().tabs);
    tabs.discover = {
      stack: [{ name: "discover" }, creatorRoute],
      index: 1,
    };
    useAppStore.setState({
      activeTab: "discover",
      route: creatorRoute,
      previousRoute: { name: "discover" },
      tabs,
      settings: {
        ...DEFAULT_SETTINGS,
        blockedCreators: [{ service: "patreon", id: "42", name: "Ada" }],
      },
    });

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);

    await waitFor(() =>
      expect(useAppStore.getState().route).toEqual({ name: "discover" }),
    );
    expect(screen.queryByText("Creator blocked")).not.toBeInTheDocument();
    expect(
      useAppStore
        .getState()
        .toasts.some((toast) => toast.title === "Creator blocked"),
    ).toBe(true);
  });

  it("puts the filter action after block and status below the buttons", async () => {
    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);

    const updated = await screen.findByText(/Updated/);
    const favorite = screen.getByRole("button", { name: "Favorite" });
    const block = screen.getByRole("button", { name: "Block" });
    const filter = screen.getByRole("button", { name: "Filter posts" });

    expect(
      favorite.compareDocumentPosition(block) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      block.compareDocumentPosition(filter) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      filter.compareDocumentPosition(updated) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("does not mark a creator as ASMR from filtered search results", async () => {
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
    vi.mocked(api.getCreatorPosts).mockImplementation(async (params) => ({
      items: [
        params.query
          ? {
              ...post,
              title: "ASMR search result",
              attachmentCount: 1,
              mediaKinds: ["audio"],
            }
          : post,
      ],
      offset: 0,
      hasMore: false,
    }));

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    expect(await screen.findByText("First post")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search this creator's posts"), {
      target: { value: "asmr" },
    });
    await waitFor(() =>
      expect(api.getCreatorPosts).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "asmr" }),
      ),
    );
    expect(await screen.findByText("ASMR search result")).toBeInTheDocument();

    expect(loadCreatorFilter("patreon", "42").asmr).toBeUndefined();
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
  });

  it("returns ASMR to auto-detect when creator filters are cleared", async () => {
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
    saveCreatorFilter("patreon", "42", {
      audioOnly: true,
      mediaFilter: "all",
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: ["sketch"],
      asmr: true,
    });

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Filter posts" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Clear filters",
      }),
    );

    const cleared = loadCreatorFilter("patreon", "42");
    expect(cleared.asmr).toBeUndefined();
    expect(cleared.audioOnly).toBe(false);
    expect(cleared.keywords).toEqual([]);
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
  });

  it("overrides global hidden keywords for this creator", async () => {
    useAppStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        hiddenKeywords: ["spoiler"],
      },
    });
    vi.mocked(api.getCreatorPosts).mockResolvedValue({
      items: [
        { ...post, title: "Spoiler post" },
        { ...post, id: "2", title: "Safe post" },
      ],
      offset: 0,
      hasMore: false,
    });

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    expect(await screen.findByText("Safe post")).toBeInTheDocument();
    expect(screen.queryByText("Spoiler post")).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Filter posts" }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Override global keywords" }),
    );
    expect(await screen.findByText("Spoiler post")).toBeInTheDocument();

    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
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

  it("keeps the selected tab when leaving and returning", async () => {
    const first = wrapper(
      <CreatorProfilePage service="patreon" creatorId="42" />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Similar Creators" }),
    );
    expect(await screen.findByText("Grace")).toBeInTheDocument();
    first.unmount();

    wrapper(<CreatorProfilePage service="patreon" creatorId="42" />);
    expect(await screen.findByText("Grace")).toBeInTheDocument();
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
