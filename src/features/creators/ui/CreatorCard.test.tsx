import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatorSummary, PostDetail, PostSummary } from "../../../shared/types";
import { api } from "../../../shared/api";
import { usePlayerStore } from "../../player/model/store";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import { saveCreatorFilter } from "../../../shared/lib/creatorFilters";
import { useAppStore } from "../../../app/store";
import { CreatorCard } from "./CreatorCard";
import { PostCard } from "../../posts/ui/PostCard";

const creator: CreatorSummary = {
  id: "42",
  name: "Ada Lovelace",
  service: "patreon",
  public_id: "ada",
  indexed: 1700000000,
  updated: 1700000000,
  favorited: 1200,
};

const post: PostSummary = {
  id: "99",
  service: "fanbox",
  user: "7",
  creatorName: "Grace Hopper",
  title: "Sample post",
  excerpt: "A post excerpt",
  published: 1700000000,
  added: 1700000000,
  thumbnailUrl: null,
  attachmentCount: 2,
  mediaKinds: ["image", "video"],
  previewState: null,
  hasFull: true,
  imported: true,
  exceedsLimit: false,
  unavailable: false,
};

function wrapper(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("content cards", () => {
  it("renders creator metadata and opens the profile", () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, postCardSize: "small" },
    });
    wrapper(<CreatorCard creator={creator} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Patreon")).toBeInTheDocument();
    expect(screen.getByText("1.2k favorites")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Open Ada Lovelace"));
    expect(window.location.hash).toBe("#/creator/patreon/42");
  });

  it("shows the ASMR tag from a saved creator filter", () => {
    saveCreatorFilter("patreon", "42", {
      audioOnly: true,
      hideNoMedia: false,
      hideUnavailable: false,
      keywords: [],
      asmr: true,
    });
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, postCardSize: "large" } });
    wrapper(<CreatorCard creator={creator} />);
    expect(screen.getByText("ASMR")).toBeInTheDocument();
    window.localStorage.removeItem("pawchive-creator-filter:patreon:42");
  });

  it("applies the selected post card size", () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, postCardSize: "small" },
    });
    wrapper(<PostCard post={post} />);
    expect(document.querySelector('[data-card-size="small"]')).toBeTruthy();
    useAppStore.setState({ settings: DEFAULT_SETTINGS });
  });

  it("renders post metadata and opens the post viewer", () => {
    wrapper(<PostCard post={post} />);
    expect(screen.getByText("Sample post")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Open Sample post"));
    expect(window.location.hash).toBe("#/post/fanbox/7/99");
  });

  it("marks unimported posts and creators", () => {
    wrapper(
      <>
        <PostCard post={{ ...post, imported: false }} />
        <CreatorCard creator={{ ...creator, ever_imported: false }} />
      </>,
    );
    expect(
      screen.getByTitle("haven't archived this post yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("haven't imported this creator yet"),
    ).toBeInTheDocument();
  });

  it("starts playback from the post preview play button", async () => {
    const detail = {
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Sample post",
        content: "",
        embed: {},
        attachments: [],
        file: null,
        added: 1700000000,
        published: 1700000000,
      },
      attachments: [
        {
          name: "clip.mp3",
          path: "/aa/bb/clip.mp3",
          url: "https://file.pawchive.pw/data/aa/bb/clip.mp3",
          thumbnailUrl: null,
          kind: "audio",
          provider: "pawchive",
          ext: "mp3",
          previewOnly: false,
        },
      ],
      creator: {
        id: "7",
        name: "Grace Hopper",
        service: "fanbox",
      },
      next: null,
      prev: null,
    } as unknown as PostDetail;
    const getPost = vi.spyOn(api, "getPost").mockResolvedValue(detail);
    usePlayerStore.setState({ queue: [], currentId: null, playing: false });

    wrapper(
      <PostCard post={{ ...post, mediaKinds: ["audio"], attachmentCount: 1 }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play Sample post" }));

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(1));
    expect(getPost).toHaveBeenCalledWith(
      expect.objectContaining({ service: "fanbox", creatorId: "7", postId: "99" }),
    );
    expect(usePlayerStore.getState().queue[0]).toMatchObject({
      mediaKind: "audio",
      title: "Sample post",
      creatorName: "Grace Hopper",
    });
    usePlayerStore.setState({ queue: [], currentId: null, playing: false });
  });

  it("resolves provider attachments before starting card playback", async () => {
    const fast = {
      post: {
        id: "99",
        user: "7",
        service: "fanbox",
        title: "Provider post",
        content: "",
        embed: {},
        attachments: [],
        file: null,
        added: 1700000000,
        published: 1700000000,
      },
      attachments: [
        {
          name: "mega-link",
          path: "https://mega.nz/#P!protected",
          url: "https://mega.nz/#P!protected",
          thumbnailUrl: null,
          kind: "other",
          provider: "mega",
          ext: "",
          previewOnly: false,
          resolving: true,
        },
      ],
      creator: { id: "7", name: "Grace Hopper", service: "fanbox" },
      next: null,
      prev: null,
    } as unknown as PostDetail;
    vi.spyOn(api, "getPost").mockResolvedValue(fast);
    const resolve = vi.spyOn(api, "resolvePostAttachments").mockResolvedValue([
      {
        ...fast.attachments[0],
        name: "resolved.mp4",
        kind: "video",
        resolving: false,
      },
    ]);
    usePlayerStore.setState({ queue: [], currentId: null, playing: false });

    wrapper(
      <PostCard post={{ ...post, mediaKinds: ["video"], attachmentCount: 1 }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play Sample post" }));

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(1));
    expect(resolve).toHaveBeenCalledWith(fast.attachments);
    expect(usePlayerStore.getState().queue[0]).toMatchObject({
      fileName: "resolved.mp4",
      mediaKind: "video",
    });
    usePlayerStore.setState({ queue: [], currentId: null, playing: false });
  });

  it("marks posts that exceed the archive size limit", () => {
    wrapper(<PostCard post={{ ...post, hasFull: false, exceedsLimit: true }} />);
    expect(
      screen.getByTitle(
        "Some files exceed the archive size limit and weren't saved",
      ),
    ).toBeInTheDocument();
  });
});
