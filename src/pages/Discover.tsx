import { useInfiniteQuery } from "@tanstack/react-query";
import { Compass, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../services/api";
import { errorMessage } from "../lib/constants";
import { isCreatorBlocked } from "../lib/blockedCreators";
import { cn } from "../lib/format";
import { creatorGridMetrics, postGridMetrics } from "../lib/layout";
import { useAppStore } from "../stores/app";
import {
  CreatorCard,
  CreatorCardSkeleton,
  PostCard,
  PostCardSkeleton,
} from "../components/cards";
import { CardGrid } from "../components/CardGrid";
import { Button, EmptyState } from "../components/ui";
import type { CreatorSummary, PostSummary } from "../types";

type Tab = "posts" | "creators";
type Feed = "recent" | "popular";

// Keep the selected feed and filters when the user visits another page and
// comes back. The initial view is Popular, not Recent.
const savedDiscoverView = {
  tab: "posts" as Tab,
  feed: "popular" as Feed,
  service: "",
  sort: "popular",
};

export function DiscoverPage() {
  const [tab, setTabState] = useState<Tab>(savedDiscoverView.tab);
  const [feed, setFeedState] = useState<Feed>(savedDiscoverView.feed);
  const [service, setServiceState] = useState(savedDiscoverView.service);
  const [sort, setSortState] = useState(savedDiscoverView.sort);
  const setTab = (value: Tab) => {
    savedDiscoverView.tab = value;
    setTabState(value);
  };
  const setFeed = (value: Feed) => {
    savedDiscoverView.feed = value;
    setFeedState(value);
  };
  const setService = (value: string) => {
    savedDiscoverView.service = value;
    setServiceState(value);
  };
  const setSort = (value: string) => {
    savedDiscoverView.sort = value;
    setSortState(value);
  };
  const indexState = useAppStore((state) => state.indexState);
  const ensureCreatorIndex = useAppStore((state) => state.ensureCreatorIndex);
  const postCardSize = useAppStore((state) => state.settings.postCardSize);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const postMetrics = postGridMetrics(postCardSize);
  const creatorMetrics = creatorGridMetrics(postCardSize);

  const posts = useInfiniteQuery({
    queryKey: ["posts", "discover"],
    queryFn: ({ pageParam, signal }) =>
      api.getRecentPosts({ offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 50 : undefined),
    enabled: tab === "posts" && feed === "recent",
    staleTime: 60_000,
  });

  const popular = useInfiniteQuery({
    queryKey: ["posts", "popular"],
    queryFn: ({ pageParam, signal }) =>
      api.getPopularPosts({ offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 50 : undefined),
    enabled: tab === "posts" && feed === "popular",
    staleTime: 60_000,
  });

  const creators = useInfiniteQuery({
    queryKey: ["creators", "discover", service, sort],
    queryFn: ({ pageParam }) =>
      api.listCreators({
        service: service || undefined,
        sort,
        offset: pageParam,
        limit: 60,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 60 : undefined),
    enabled: tab === "creators",
    staleTime: 60_000,
  });

  const activePosts = feed === "popular" ? popular : posts;

  const postItems = useMemo(() => {
    const map = new Map<string, PostSummary>();
    for (const page of activePosts.data?.pages ?? []) {
      for (const post of page.items) {
        if (isCreatorBlocked(blockedCreators, post.service, post.user)) continue;
        map.set(`${post.service}:${post.user}:${post.id}`, post);
      }
    }
    return [...map.values()];
  }, [activePosts.data, blockedCreators]);

  const visiblePostItems = useMemo(
    () =>
      service
        ? postItems.filter((post) => post.service === service)
        : postItems,
    [postItems, service],
  );

  const creatorItems = useMemo(() => {
    const map = new Map<string, CreatorSummary>();
    for (const page of creators.data?.pages ?? []) {
      for (const creator of page.items) {
        if (isCreatorBlocked(blockedCreators, creator.service, creator.id)) {
          continue;
        }
        map.set(`${creator.service}:${creator.id}`, creator);
      }
    }
    return [...map.values()];
  }, [creators.data, blockedCreators]);

  const loadMorePosts = useCallback(() => {
    if (activePosts.hasNextPage && !activePosts.isFetchingNextPage) {
      void activePosts.fetchNextPage();
    }
  }, [activePosts]);

  const loadMoreCreators = useCallback(() => {
    if (creators.hasNextPage && !creators.isFetchingNextPage) {
      void creators.fetchNextPage();
    }
  }, [creators]);

  return (
    <div className="pb-10">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line/70 bg-surface/50 p-1">
          <button
            type="button"
            onClick={() => {
              setTab("posts");
              setFeed("recent");
            }}
            className={cn(
              "rounded px-3 py-1.5 text-[11px] font-medium transition",
              tab === "posts" && feed === "recent"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-ink",
            )}
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("posts");
              setFeed("popular");
            }}
            className={cn(
              "rounded px-3 py-1.5 text-[11px] font-medium transition",
              tab === "posts" && feed === "popular"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-ink",
            )}
          >
            Popular
          </button>
          <button
            type="button"
            onClick={() => setTab("creators")}
            className={cn(
              "rounded px-3 py-1.5 text-[11px] font-medium transition",
              tab === "creators"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-ink",
            )}
          >
            Creators
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {tab === "posts" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void activePosts.refetch()}
              disabled={activePosts.isFetching}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  activePosts.isFetching && "animate-spin",
                )}
              />
              Refresh
            </Button>
          ) : (
            <>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort creators"
                className="h-8 rounded-lg border border-line/70 bg-base/55 px-2 text-[11px] text-ink outline-none"
              >
                <option value="popular">Most favourited</option>
                <option value="updated">Recently updated</option>
                <option value="name">Name A–Z</option>
              </select>
              {indexState === "error" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void ensureCreatorIndex(true)}
                >
                  Retry index
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {tab === "posts" ? (
        <>
          {activePosts.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <PostCardSkeleton key={index} />
              ))}
            </div>
          ) : activePosts.isError ? (
            <EmptyState
              icon={Compass}
              title={`Could not load ${feed} posts`}
              message={errorMessage(activePosts.error)}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void activePosts.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : visiblePostItems.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No posts found on this page"
              message="Your content filters may have hidden every post on this page."
              action={
                activePosts.hasNextPage ? (
                  <Button
                    variant="secondary"
                    loading={activePosts.isFetchingNextPage}
                    onClick={() => void activePosts.fetchNextPage()}
                  >
                    Load next page
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <CardGrid
                items={visiblePostItems}
                getKey={(post) => `${post.service}:${post.user}:${post.id}`}
                renderItem={(post) => (
                  <PostCard post={post} enrichMedia={feed === "popular"} />
                )}
                minColumnWidth={postMetrics.minColumnWidth}
                itemHeight={postMetrics.rowHeight}
                onEndReached={loadMorePosts}
              />
              {activePosts.isFetchingNextPage ? (
                <div className="flex justify-center py-5">
                  <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                </div>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          {creators.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <CreatorCardSkeleton key={index} />
              ))}
            </div>
          ) : creators.isError ? (
            <EmptyState
              icon={Users}
              title="Could not load creators"
              message={errorMessage(creators.error)}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void creators.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : creatorItems.length === 0 ? (
            <EmptyState
              icon={Users}
              title={
                indexState === "syncing"
                  ? "Indexing creators…"
                  : "No creators found"
              }
              message={
                indexState === "syncing"
                  ? "The archive directory is being stored locally for fast search."
                  : "Try another service filter."
              }
            />
          ) : (
            <>
              <CardGrid
                items={creatorItems}
                getKey={(creator) => `${creator.service}:${creator.id}`}
                renderItem={(creator) => <CreatorCard creator={creator} />}
                minColumnWidth={creatorMetrics.minColumnWidth}
                itemHeight={creatorMetrics.rowHeight}
                onEndReached={loadMoreCreators}
              />
              {creators.isFetchingNextPage ? (
                <div className="flex justify-center py-5">
                  <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
