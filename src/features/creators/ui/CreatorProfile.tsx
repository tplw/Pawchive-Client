import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CalendarDays,
  Filter,
  Info,
  LoaderCircle,
  Search,
  Users,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import {
  addBlockedCreator,
  isCreatorBlocked,
} from "../../../shared/lib/blockedCreators";
import { BlockedCreatorNotice } from "./BlockedCreatorNotice";
import { nextOffset, uniqueBy } from "../../../shared/query/pagination";
import { queryKeys } from "../../../shared/query/keys";
import {
  creatorFilterActive,
  detectAsmrCreator,
  postMatchesCreatorFilter,
} from "../../../shared/lib/creatorFilters";
import { cn, formatRelative, shortNumber } from "../../../shared/lib/format";
import { creatorGridMetrics, postGridMetrics } from "../../../shared/lib/layout";
import { goBack, routeTitle } from "../../../shared/lib/router";
import { useAppStore } from "../../../app/store";
import { usePlayerStore } from "../../player/model/store";
import { useDebouncedValue } from "../../../shared/lib/useDebouncedValue";
import { PostCard, PostCardSkeleton } from "../../posts/ui/PostCard";
import {
  CreatorAvatar,
  CreatorBanner,
  NotImportedBadge,
  ServiceBadge,
} from "./CreatorVisuals";
import { CreatorCard, CreatorCardSkeleton } from "./CreatorCard";
import { CardGrid } from "../../../shared/CardGrid";
import { CreatorAbout } from "./CreatorAbout";
import { CreatorAnnouncements } from "./CreatorAnnouncements";
import { CreatorFilterModal } from "./CreatorFilterModal";
import { useCreatorFilterState } from "../model/useCreatorFilterState";
import { SiteIcon } from "../../../shared/SiteIcon";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  SectionHeader,
} from "../../../shared/ui";

type Tab = "posts" | "about" | "announcements" | "similar";

export function CreatorProfilePage({
  service,
  creatorId,
}: {
  service: string;
  creatorId: string;
}) {
  const blocked = useAppStore((state) =>
    isCreatorBlocked(state.settings.blockedCreators ?? [], service, creatorId),
  );
  if (blocked) return <BlockedCreatorNotice service={service} id={creatorId} />;
  return <CreatorProfileContent service={service} creatorId={creatorId} />;
}

function CreatorProfileContent({
  service,
  creatorId,
}: {
  service: string;
  creatorId: string;
}) {
  const [tab, setTab] = useState<Tab>("posts");
  const [filterOpen, setFilterOpen] = useState(false);
  const [postSearch, setPostSearch] = useState("");
  const debouncedPostSearch = useDebouncedValue(postSearch.trim(), 300);
  const postQuery = debouncedPostSearch.length >= 3 ? debouncedPostSearch : "";
  const postCardSize = useAppStore((state) => state.settings.postCardSize);
  const autoDetectAsmr = useAppStore((state) => state.settings.autoDetectAsmr);
  const hideNoMediaDefault = useAppStore(
    (state) => state.settings.hideNoMedia,
  );
  const { filter, keywordText, updateFilter, clearFilter, changeKeywords } =
    useCreatorFilterState({ service, creatorId, hideNoMediaDefault });
  const hideUnavailablePosts = useAppStore(
    (state) => state.settings.hideUnavailablePosts,
  );
  const postMetrics = postGridMetrics(postCardSize);
  const creatorMetrics = creatorGridMetrics(postCardSize);
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const previousRoute = useAppStore((state) => state.previousRoute);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const saveSettings = useAppStore((state) => state.saveSettings);

  const creator = useQuery({
    queryKey: queryKeys.creator(service, creatorId),
    queryFn: () => api.getCreator(service, creatorId),
    staleTime: 60_000,
  });
  const profile = useQuery({
    queryKey: queryKeys.creatorProfile(service, creatorId),
    queryFn: ({ signal }) => api.getCreatorProfile(service, creatorId, signal),
    staleTime: 300_000,
  });
  const links = useQuery({
    queryKey: queryKeys.creatorLinks(service, creatorId),
    queryFn: ({ signal }) => api.getCreatorLinks(service, creatorId, signal),
    staleTime: 300_000,
  });
  const announcements = useQuery({
    queryKey: queryKeys.creatorAnnouncements(service, creatorId),
    queryFn: ({ signal }) =>
      api.getCreatorAnnouncements(service, creatorId, signal),
    staleTime: 180_000,
    enabled: tab === "announcements",
  });
  const similar = useQuery({
    queryKey: queryKeys.creatorSimilar(service, creatorId),
    queryFn: ({ signal }) =>
      api.getSimilarCreators(service, creatorId, signal),
    staleTime: 300_000,
    enabled: tab === "similar",
  });
  const posts = useInfiniteQuery({
    queryKey: queryKeys.creatorPosts(service, creatorId, postQuery),
    queryFn: ({ pageParam, signal }) =>
      api.getCreatorPosts({
        service,
        creatorId,
        offset: pageParam,
        query: postQuery || undefined,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => nextOffset(last, 50),
    staleTime: 60_000,
  });

  const postItems = useMemo(
    () =>
      uniqueBy(
        (posts.data?.pages ?? []).flatMap((page) => page.items),
        (post) => `${post.service}:${post.user}:${post.id}`,
      ),
    [posts.data],
  );

  const loadMore = useCallback(() => {
    if (posts.hasNextPage && !posts.isFetchingNextPage) {
      void posts.fetchNextPage();
    }
  }, [posts]);

  const summary = creator.data;
  const details = profile.data;
  const name = details?.name || summary?.name || creatorId;
  const blockCreator = () => {
    usePlayerStore.getState().removeCreator(service, creatorId);
    void saveSettings({
      blockedCreators: addBlockedCreator(blockedCreators, {
        service,
        id: creatorId,
        name,
      }),
    }).then(() => {
      void queryClient.invalidateQueries();
      toast(
        "success",
        "Creator blocked",
        `${name} is hidden from feeds, search and direct links.`,
      );
    });
  };
  const detectedAsmr = useMemo(
    () => detectAsmrCreator(name, details?.description, postItems),
    [name, details?.description, postItems],
  );
  const isAsmr = filter.asmr ?? detectedAsmr;
  const autoAudioOnly = isAsmr && autoDetectAsmr && filter.asmr !== false;
  const effectiveFilter = useMemo(
    () => ({ ...filter, audioOnly: filter.audioOnly || autoAudioOnly }),
    [filter, autoAudioOnly],
  );
  const filteredPostItems = useMemo(
    () =>
      postItems.filter((post) => postMatchesCreatorFilter(post, effectiveFilter)),
    [postItems, effectiveFilter],
  );
  const similarCreators = useMemo(
    () =>
      (similar.data ?? []).filter(
        (entry) => !(entry.service === service && entry.id === creatorId),
      ).filter(
        (entry) =>
          !hideUnavailablePosts || entry.ever_imported !== false,
      ),
    [similar.data, service, creatorId, hideUnavailablePosts],
  );

  const favorite = useMutation({
    mutationFn: (favorited: boolean) =>
      api.setFavoriteCreator({
        service,
        creatorId,
        name,
        publicId: details?.public_id ?? summary?.public_id ?? null,
        favorited,
      }),
    onSuccess: (favorited) => {
      toast(
        "success",
        favorited ? "Creator added to favorites" : "Creator removed from favorites",
        name,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesCreators() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creator(service, creatorId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creators() });
    },
    onError: (error) => reportError(error, "Could not update favorite"),
  });
  const updated = details?.updated ?? summary?.updated;
  const favorited = summary?.favorited;
  const everImported = details?.ever_imported ?? summary?.ever_imported;
  const backTarget =
    previousRoute && previousRoute.name !== "creator"
      ? previousRoute
      : { name: "creators" as const };
  const backLabel =
    previousRoute && previousRoute.name !== "creator"
      ? `Back to ${routeTitle(previousRoute).toLowerCase()}`
      : "Back to creators";

  return (
    <div className="pb-10">
      <button
        type="button"
        onClick={() => goBack(backTarget)}
        className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </button>

      <section className="overflow-hidden rounded-2xl border border-line/70 bg-surface/45">
        <div className="relative h-40 overflow-hidden bg-elevated sm:h-52">
          <CreatorBanner service={service} id={creatorId} name={name} />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
        </div>
        <div className="relative px-5 pb-5 sm:px-7">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <CreatorAvatar
                service={service}
                id={creatorId}
                name={name}
                size="xl"
                className="ring-4 ring-surface"
              />
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
                  {name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ServiceBadge service={service} />
                  {isAsmr ? (
                    <Badge tone="accent">ASMR</Badge>
                  ) : null}
                  {everImported === false ? <NotImportedBadge creator /> : null}
                  {summary?.public_id ? (
                    <span className="text-[10px] text-muted">
                      @{summary.public_id}
                    </span>
                  ) : null}
                  {favorited ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                      <Users className="h-3 w-3" /> {shortNumber(favorited)} archive favourites
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-1 text-[10px] text-muted">
              <Button
                variant="secondary"
                size="sm"
                loading={favorite.isPending}
                onClick={() => favorite.mutate(!summary?.is_favorite)}
              >
                <SiteIcon
                  name="favorites"
                  size={15}
                  tone={summary?.is_favorite ? "favorite" : "default"}
                />
                {summary?.is_favorite ? "Favorited" : "Favorite"}
              </Button>
              <IconButton
                label="Filter posts"
                icon={Filter}
                active={creatorFilterActive(effectiveFilter)}
                onClick={() => setFilterOpen(true)}
              />
              <Button variant="secondary" size="sm" onClick={blockCreator}>
                <Ban className="h-3.5 w-3.5" /> Block
              </Button>
              {updated ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> Updated {formatRelative(updated)}
                </span>
              ) : null}
              {profile.isError ? (
                <span className="inline-flex items-center gap-1 text-amber-400/80">
                  <AlertCircle className="h-3 w-3" /> Profile details unavailable
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line/60">
            {(
              [
                ["posts", "Posts"],
                ["about", "About & links"],
                ["announcements", "Announcements"],
                ["similar", "Similar Creators"],
              ] as Array<[Tab, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "relative shrink-0 px-3 py-2.5 text-xs font-medium transition",
                  tab === value ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {label}
                {tab === value ? (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "posts" ? (
        <section className="mt-6">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80">
            Posts
          </p>
          <div className="relative mb-4 max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={postSearch}
              onChange={(event) => setPostSearch(event.target.value)}
              placeholder="Search this creator's posts…"
              spellCheck={false}
              aria-label="Search this creator's posts"
              className="h-10 w-full rounded-xl border border-line/70 bg-surface/55 pl-9 pr-9 text-sm text-ink outline-none placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/10"
            />
            {postSearch ? (
              <button
                type="button"
                aria-label="Clear post search"
                onClick={() => setPostSearch("")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-white/8 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {postSearch.trim().length > 0 && postQuery === "" ? (
            <p className="mb-3 text-[10px] text-muted">
              Type at least 3 characters to search.
            </p>
          ) : null}
          {posts.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <PostCardSkeleton key={index} />
              ))}
            </div>
          ) : posts.isError ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load this creator's posts"
              message={errorMessage(posts.error)}
              action={
                <Button variant="secondary" onClick={() => void posts.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : filteredPostItems.length === 0 ? (
            <EmptyState
              icon={Info}
              title={
                postQuery
                  ? "No posts match your search"
                  : postItems.length === 0
                    ? "No visible posts"
                    : "No posts match your filters"
              }
              message={
                postQuery
                  ? "Try a different search term or clear the search."
                  : postItems.length === 0
                    ? "The archive has no posts for this creator, or your content filters hid them."
                    : "Adjust or clear this creator's custom filters to see more posts."
              }
              action={
                postQuery ? (
                  <Button variant="secondary" onClick={() => setPostSearch("")}>
                    Clear search
                  </Button>
                ) : creatorFilterActive(effectiveFilter) ? (
                  <Button
                    variant="secondary"
                    onClick={clearFilter}
                  >
                    Clear filters
                  </Button>
                ) : posts.hasNextPage ? (
                  <Button
                    variant="secondary"
                    loading={posts.isFetchingNextPage}
                    onClick={() => void posts.fetchNextPage()}
                  >
                    Load next page
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <CardGrid
                items={filteredPostItems}
                getKey={(post) => `${post.service}:${post.user}:${post.id}`}
                renderItem={(post) => <PostCard post={post} />}
                minColumnWidth={postMetrics.minColumnWidth}
                itemHeight={postMetrics.rowHeight}
                onEndReached={loadMore}
              />
              {posts.isFetchingNextPage ? (
                <div className="flex justify-center py-5">
                  <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {tab === "about" ? (
        <CreatorAbout
          service={service}
          creatorId={creatorId}
          summary={summary}
          details={details}
          updated={updated}
          links={links}
        />
      ) : null}

      {tab === "announcements" ? (
        <CreatorAnnouncements announcements={announcements} />
      ) : null}

      {tab === "similar" ? (
        <section className="mt-6">
          <SectionHeader
            eyebrow="Discover"
            title="Similar creators"
            description={`Creators the archive recommends alongside ${name}.`}
          />
          {similar.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <CreatorCardSkeleton key={index} />
              ))}
            </div>
          ) : similar.isError ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load similar creators"
              message={errorMessage(similar.error)}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void similar.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : similarCreators.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No similar creators"
              message="The archive has no recommendations for this creator yet."
            />
          ) : (
            <CardGrid
              items={similarCreators}
              getKey={(creator) => `${creator.service}:${creator.id}`}
              renderItem={(creator) => <CreatorCard creator={creator} />}
              minColumnWidth={creatorMetrics.minColumnWidth}
              itemHeight={creatorMetrics.rowHeight}
            />
          )}
        </section>
      ) : null}

      <CreatorFilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        name={name}
        filter={filter}
        keywordText={keywordText}
        isAsmr={isAsmr}
        detectedAsmr={detectedAsmr}
        autoAudioOnly={autoAudioOnly}
        effectiveFilter={effectiveFilter}
        onUpdateFilter={updateFilter}
        onClear={clearFilter}
        onKeywordsChange={changeKeywords}
      />
    </div>
  );
}
