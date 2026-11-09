import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { CreatorSummary, PostSummary } from "../../../types";
import { DEFAULT_SETTINGS } from "../../../lib/constants";
import { useAppStore } from "../../../stores/app";
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

  it("marks posts that exceed the archive size limit", () => {
    wrapper(<PostCard post={{ ...post, hasFull: false, exceedsLimit: true }} />);
    expect(
      screen.getByTitle(
        "Some files exceed the archive size limit and weren't saved",
      ),
    ).toBeInTheDocument();
  });
});
