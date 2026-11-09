import { useInfiniteQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../services/api";
import { errorMessage } from "../../../lib/constants";
import { nextOffset } from "../../../shared/query/pagination";
import { visibleCreators } from "../model/feed";
import { queryKeys } from "../../../shared/query/keys";
import { cn, shortNumber } from "../../../lib/format";
import { creatorGridMetrics } from "../../../lib/layout";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useAppStore } from "../../../stores/app";
import { CreatorCard, CreatorCardSkeleton } from "./CreatorCard";
import { CardGrid } from "../../../components/CardGrid";
import { Button, EmptyState, SectionHeader } from "../../../components/ui";

/** Preserve directory filters when navigating to a creator and back. */
const savedCreatorsView = {
  search: "",
  service: "",
  sort: "popular",
};

export function CreatorsPage({ query = "" }: { query?: string }) {
  const [search, setSearch] = useState(query || savedCreatorsView.search);
  const [service, setService] = useState(savedCreatorsView.service);
  const [sort, setSort] = useState(savedCreatorsView.sort);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const indexState = useAppStore((state) => state.indexState);
  const indexCount = useAppStore((state) => state.indexCount);
  const ensureCreatorIndex = useAppStore((state) => state.ensureCreatorIndex);
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const creatorMetrics = creatorGridMetrics(cardSize);
  const queryRef = useRef(query);

  useEffect(() => {
    if (queryRef.current === query) return;
    queryRef.current = query;
    setSearch(query);
  }, [query]);

  useEffect(() => {
    savedCreatorsView.search = search;
    savedCreatorsView.service = service;
    savedCreatorsView.sort = sort;
  }, [search, service, sort]);

  const creators = useInfiniteQuery({
    queryKey: queryKeys.creatorsDirectory(debouncedSearch, service, sort),
    queryFn: ({ pageParam }) =>
      api.listCreators({
        query: debouncedSearch || undefined,
        service: service || undefined,
        sort,
        offset: pageParam,
        limit: 60,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => nextOffset(last, 60),
    staleTime: 30_000,
  });

  const items = useMemo(
    () =>
      visibleCreators(
        (creators.data?.pages ?? []).flatMap((page) => page.items),
        blockedCreators,
      ),
    [blockedCreators, creators.data],
  );

  const total = creators.data?.pages[0]?.total ?? 0;
  const loadMore = useCallback(() => {
    if (creators.hasNextPage && !creators.isFetchingNextPage) {
      void creators.fetchNextPage();
    }
  }, [creators]);

  return (
    <div className="pb-10">
      <SectionHeader
        eyebrow="Creator directory"
        title="Creators"
        description={
          indexCount > 0
            ? `${shortNumber(indexCount)} creators indexed locally for instant search.`
            : "The creator directory is being indexed in the background."
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void ensureCreatorIndex(true)}
            disabled={indexState === "syncing"}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", indexState === "syncing" && "animate-spin")}
            />
            Refresh index
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or public ID…"
            spellCheck={false}
            className="h-10 w-full rounded-xl border border-line/70 bg-surface/55 pl-9 pr-9 text-sm text-ink outline-none placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/10"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-white/8 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <select
          value={service}
          onChange={(event) => setService(event.target.value)}
          aria-label="Service filter"
          className="h-10 rounded-xl border border-line/70 bg-surface/55 px-2.5 text-[11px] text-ink outline-none"
        >
          <option value="">All services</option>
          <option value="patreon">Patreon</option>
          <option value="fanbox">Pixiv Fanbox</option>
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Sort creators"
          className="h-10 rounded-xl border border-line/70 bg-surface/55 px-2.5 text-[11px] text-ink outline-none"
        >
          <option value="popular">Most favourited</option>
          <option value="updated">Recently updated</option>
          <option value="name">Name A–Z</option>
          <option value="indexed">Recently indexed</option>
        </select>
      </div>

      {creators.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <CreatorCardSkeleton key={index} />
          ))}
        </div>
      ) : creators.isError ? (
        <EmptyState
          icon={Users}
          title="Could not read the creator index"
          message={errorMessage(creators.error)}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void creators.refetch()}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => void ensureCreatorIndex(true)}>
                Rebuild index
              </Button>
            </div>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            indexState === "syncing"
              ? "Indexing creators…"
              : debouncedSearch
                ? "No creators match that search"
                : "No creators indexed yet"
          }
          message={
            indexState === "syncing"
              ? "The directory is downloaded once, then searches are instant and offline."
              : indexState === "error"
                ? "The creator index could not be downloaded. Check your connection and retry."
                : "Try a different name or clear the filters."
          }
          action={
            indexState === "error" ? (
              <Button variant="secondary" onClick={() => void ensureCreatorIndex(true)}>
                Retry
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-[10px] text-muted">
            <span>
              {shortNumber(total)} result{total === 1 ? "" : "s"}
            </span>
            {creators.isFetching && !creators.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="h-3 w-3 animate-spin" /> Updating
              </span>
            ) : null}
          </div>
          <CardGrid
            items={items}
            getKey={(creator) => `${creator.service}:${creator.id}`}
            renderItem={(creator) => <CreatorCard creator={creator} />}
            minColumnWidth={creatorMetrics.minColumnWidth}
            itemHeight={creatorMetrics.rowHeight}
            onEndReached={loadMore}
          />
          {creators.isFetchingNextPage ? (
            <div className="flex justify-center py-5">
              <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
