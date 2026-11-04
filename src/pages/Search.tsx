import { useInfiniteQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  FileText,
  ArrowRight,
  FileSearch,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music2,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { errorMessage } from "../lib/constants";
import { cn } from "../lib/format";
import { creatorGridMetrics, postGridMetrics } from "../lib/layout";
import { useAppStore } from "../stores/app";
import { recordTiming } from "../lib/perf";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { navigate } from "../lib/router";
import {
  CreatorCard,
  PostCard,
  PostCardSkeleton,
} from "../components/cards";
import { CardGrid } from "../components/CardGrid";
import { Button, EmptyState, SectionHeader, TextInput } from "../components/ui";
import type { CreatorSummary, MediaKind, PostSummary } from "../types";

type ContentFilter = "all" | "posts" | "creators";

const MEDIA_OPTIONS: Array<{
  kind: MediaKind;
  label: string;
  icon: typeof ImageIcon;
}> = [
  { kind: "image", label: "Images", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Film },
  { kind: "audio", label: "Audio", icon: Music2 },
  { kind: "document", label: "Files", icon: FileText },
];

export function SearchPage({ query }: { query: string }) {
  const [draft, setDraft] = useState(query);
  const [content, setContent] = useState<ContentFilter>("all");
  const [service, setService] = useState("");
  const [media, setMedia] = useState<MediaKind[]>([]);
  const [sort, setSort] = useState("relevance");
  const [creatorSort, setCreatorSort] = useState("popular");
  const debounced = useDebouncedValue(draft.trim(), 350);
  const postCardSize = useAppStore((state) => state.settings.postCardSize);
  const postMetrics = postGridMetrics(postCardSize);
  const creatorMetrics = creatorGridMetrics(postCardSize);
  const searchStarted = useRef(0);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    const focus = () => {
      const input = document.getElementById("search-input");
      input?.focus();
    };
    window.addEventListener("pawchive:focus-search", focus);
    return () => window.removeEventListener("pawchive:focus-search", focus);
  }, []);

  const valid = debounced.length >= 3;

  const results = useInfiniteQuery({
    queryKey: ["search", debounced, service, media, sort],
    queryFn: ({ pageParam, signal }) =>
      api.searchAll({
        query: debounced,
        offset: pageParam,
        service: service || undefined,
        media: media.length ? media : undefined,
        sort,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 50 : undefined),
    enabled: valid && content !== "creators",
    staleTime: 60_000,
  });

  const creatorSearch = useInfiniteQuery({
    queryKey: ["creators", "search", debounced, service, creatorSort],
    queryFn: ({ pageParam }) =>
      api.listCreators({
        query: debounced,
        service: service || undefined,
        sort: creatorSort,
        offset: pageParam,
        limit: 60,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 60 : undefined),
    enabled: valid && content === "creators",
    staleTime: 30_000,
  });

  const posts = useMemo(() => {
    const map = new Map<string, PostSummary>();
    for (const page of results.data?.pages ?? []) {
      for (const post of page.posts) {
        map.set(`${post.service}:${post.user}:${post.id}`, post);
      }
    }
    return [...map.values()];
  }, [results.data]);

  const creators = useMemo(() => {
    const map = new Map<string, CreatorSummary>();
    if (content === "creators") {
      for (const page of creatorSearch.data?.pages ?? []) {
        for (const creator of page.items) {
          map.set(`${creator.service}:${creator.id}`, creator);
        }
      }
    } else {
      for (const creator of results.data?.pages[0]?.creators ?? []) {
        map.set(`${creator.service}:${creator.id}`, creator);
      }
    }
    return [...map.values()];
  }, [content, creatorSearch.data, results.data]);

  const limitations = results.data?.pages[0]?.limitations ?? [];

  useEffect(() => {
    searchStarted.current = performance.now();
  }, [debounced, service, media, sort]);

  useEffect(() => {
    if (!results.isFetching && searchStarted.current > 0) {
      recordTiming("search results", searchStarted.current);
      searchStarted.current = 0;
    }
  }, [results.isFetching, results.dataUpdatedAt]);

  const loadMorePosts = useCallback(() => {
    if (results.hasNextPage && !results.isFetchingNextPage) {
      void results.fetchNextPage();
    }
  }, [results]);

  const loadMoreCreators = useCallback(() => {
    if (creatorSearch.hasNextPage && !creatorSearch.isFetchingNextPage) {
      void creatorSearch.fetchNextPage();
    }
  }, [creatorSearch]);

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 3) return;
    navigate({ name: "search", query: trimmed });
  };

  const activeError = content === "creators" ? creatorSearch.error : results.error;
  const isError = content === "creators" ? creatorSearch.isError : results.isError;
  const isLoading = content === "creators" ? creatorSearch.isLoading : results.isLoading;

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-2xl border border-line/70 bg-surface/45 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-accent">
          <SearchIcon className="h-4 w-4" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">
            Unified search
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="mt-5 flex flex-wrap gap-2"
        >
          <div className="relative min-w-56 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput
              id="search-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search posts and creators…"
              className="h-11 pl-9"
              spellCheck={false}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={draft.trim().length < 3}
          >
            <SearchIcon className="h-4 w-4" /> Search
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line/70 bg-base/40 p-0.5">
            {(["all", "posts", "creators"] as ContentFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setContent(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[10px] font-medium capitalize transition",
                  content === value
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-ink",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
            <SlidersHorizontal className="h-3 w-3" /> Refine
          </span>
          <select
            value={service}
            onChange={(event) => setService(event.target.value)}
            aria-label="Service filter"
            className="h-8 rounded-lg border border-line/70 bg-base/55 px-2 text-[11px] text-ink outline-none"
          >
            <option value="">All services</option>
            <option value="patreon">Patreon</option>
            <option value="fanbox">Pixiv Fanbox</option>
          </select>

          {content !== "creators" ? (
            <>
              {MEDIA_OPTIONS.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    setMedia((current) =>
                      current.includes(kind)
                        ? current.filter((entry) => entry !== kind)
                        : [...current, kind],
                    )
                  }
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition",
                    media.includes(kind)
                      ? "border-accent/35 bg-accent/12 text-accent"
                      : "border-line/70 text-muted hover:text-ink",
                  )}
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort posts"
                className="ml-auto h-8 rounded-lg border border-line/70 bg-base/55 px-2 text-[11px] text-ink outline-none"
              >
                <option value="relevance">Relevance</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="creator">Creator A–Z</option>
              </select>
            </>
          ) : (
            <select
              value={creatorSort}
              onChange={(event) => setCreatorSort(event.target.value)}
              aria-label="Sort creators"
              className="ml-auto h-8 rounded-lg border border-line/70 bg-base/55 px-2 text-[11px] text-ink outline-none"
            >
              <option value="popular">Most favourited</option>
              <option value="name">Name A–Z</option>
              <option value="updated">Recently updated</option>
            </select>
          )}
        </div>
      </section>

      {!valid ? (
        <EmptyState
          icon={FileSearch}
          title="Start with at least three characters"
          message="Search post titles and content, or find creators by name and public ID."
        />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <PostCardSkeleton key={index} />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Search failed"
          message={errorMessage(activeError)}
          action={
            <Button
              variant="secondary"
              onClick={() =>
                content === "creators"
                  ? void creatorSearch.refetch()
                  : void results.refetch()
              }
            >
              Try again
            </Button>
          }
        />
      ) : (
        <>
          {content !== "posts" && creators.length > 0 ? (
            <section>
              <SectionHeader
                eyebrow="Creators"
                title="Creators matching your search"
                action={
                  content !== "creators" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigate({ name: "creators", query: debounced })
                      }
                    >
                      View all <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : undefined
                }
              />
              {content === "creators" ? (
                <>
                  <CardGrid
                    items={creators}
                    getKey={(creator) => `${creator.service}:${creator.id}`}
                    renderItem={(creator) => <CreatorCard creator={creator} />}
                    minColumnWidth={creatorMetrics.minColumnWidth}
                    itemHeight={creatorMetrics.rowHeight}
                    onEndReached={loadMoreCreators}
                  />
                  {creatorSearch.isFetchingNextPage ? (
                    <div className="flex justify-center py-5">
                      <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {creators.slice(0, 4).map((creator) => (
                    <CreatorCard
                      key={`${creator.service}:${creator.id}`}
                      creator={creator}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {content !== "creators" ? (
            <section>
              <SectionHeader
                eyebrow="Posts"
                title={`${posts.length} matching post${posts.length === 1 ? "" : "s"} on this page`}
                description={
                  limitations.length > 0
                    ? limitations.join(" ")
                    : "Scroll to load more results."
                }
              />
              {posts.length === 0 ? (
                results.hasNextPage ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-muted">
                    <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                    <p className="text-xs">
                      No matches on this page. Loading the next page…
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void results.fetchNextPage()}
                    >
                      Load next page
                    </Button>
                  </div>
                ) : (
                  <EmptyState
                    icon={FileSearch}
                    title="No matching posts"
                    message="Try a broader query or remove the service and media filters."
                  />
                )
              ) : (
                <>
                  <CardGrid
                    items={posts}
                    getKey={(post) => `${post.service}:${post.user}:${post.id}`}
                    renderItem={(post) => <PostCard post={post} />}
                    minColumnWidth={postMetrics.minColumnWidth}
                    itemHeight={postMetrics.rowHeight}
                    onEndReached={loadMorePosts}
                  />
                  {results.isFetchingNextPage ? (
                    <div className="flex justify-center py-5">
                      <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {content === "creators" && creators.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No matching creators"
              message="Try another name, public ID, or service filter."
            />
          ) : null}
        </>
      )}

      {content === "all" && creators.length === 0 && posts.length > 0 ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted">
          <Sparkles className="h-3 w-3 text-accent/60" />
          No creator names matched this query; post results are shown above.
        </p>
      ) : null}
    </div>
  );
}
