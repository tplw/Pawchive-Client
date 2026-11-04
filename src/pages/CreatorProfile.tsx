import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CalendarDays,
  ExternalLink,
  Filter,
  Info,
  Link2,
  LoaderCircle,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { errorMessage, serviceLabel } from "../lib/constants";
import {
  creatorFilterActive,
  detectAsmrCreator,
  loadCreatorFilter,
  parseFilterKeywords,
  postMatchesCreatorFilter,
  saveCreatorFilter,
  type CreatorFilter,
} from "../lib/creatorFilters";
import { cn, formatDate, formatRelative, shortNumber } from "../lib/format";
import { postGridMetrics } from "../lib/layout";
import { goBack, navigate, routeTitle } from "../lib/router";
import { useAppStore } from "../stores/app";
import {
  CreatorAvatar,
  CreatorBanner,
  PostCard,
  PostCardSkeleton,
  ServiceBadge,
} from "../components/cards";
import { CardGrid } from "../components/CardGrid";
import { SanitizedHtml } from "../components/SanitizedHtml";
import { SiteIcon } from "../components/SiteIcon";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Modal,
  SectionHeader,
  Spinner,
  Toggle,
} from "../components/ui";
import type { PostSummary } from "../types";

type Tab = "posts" | "about" | "announcements";

export function CreatorProfilePage({
  service,
  creatorId,
}: {
  service: string;
  creatorId: string;
}) {
  const [tab, setTab] = useState<Tab>("posts");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<CreatorFilter>(() =>
    loadCreatorFilter(service, creatorId),
  );
  const [keywordText, setKeywordText] = useState(() =>
    loadCreatorFilter(service, creatorId).keywords.join(", "),
  );
  const postCardSize = useAppStore((state) => state.settings.postCardSize);
  const autoDetectAsmr = useAppStore((state) => state.settings.autoDetectAsmr);
  const postMetrics = postGridMetrics(postCardSize);
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const previousRoute = useAppStore((state) => state.previousRoute);

  const creator = useQuery({
    queryKey: ["creator", service, creatorId],
    queryFn: () => api.getCreator(service, creatorId),
    staleTime: 60_000,
  });
  const profile = useQuery({
    queryKey: ["creator-profile", service, creatorId],
    queryFn: ({ signal }) => api.getCreatorProfile(service, creatorId, signal),
    staleTime: 300_000,
  });
  const links = useQuery({
    queryKey: ["creator-links", service, creatorId],
    queryFn: ({ signal }) => api.getCreatorLinks(service, creatorId, signal),
    staleTime: 300_000,
  });
  const announcements = useQuery({
    queryKey: ["creator-announcements", service, creatorId],
    queryFn: ({ signal }) =>
      api.getCreatorAnnouncements(service, creatorId, signal),
    staleTime: 180_000,
    enabled: tab === "announcements",
  });
  const posts = useInfiniteQuery({
    queryKey: ["creator-posts", service, creatorId],
    queryFn: ({ pageParam, signal }) =>
      api.getCreatorPosts({ service, creatorId, offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + 50 : undefined),
    staleTime: 60_000,
  });

  const postItems = useMemo(() => {
    const map = new Map<string, PostSummary>();
    for (const page of posts.data?.pages ?? []) {
      for (const post of page.items) {
        map.set(`${post.service}:${post.user}:${post.id}`, post);
      }
    }
    return [...map.values()];
  }, [posts.data]);

  useEffect(() => {
    const next = loadCreatorFilter(service, creatorId);
    setFilter(next);
    setKeywordText(next.keywords.join(", "));
  }, [service, creatorId]);

  const updateFilter = (next: CreatorFilter) => {
    setFilter(next);
    saveCreatorFilter(service, creatorId, next);
  };

  const loadMore = useCallback(() => {
    if (posts.hasNextPage && !posts.isFetchingNextPage) {
      void posts.fetchNextPage();
    }
  }, [posts]);

  const summary = creator.data;
  const details = profile.data;
  const name = details?.name || summary?.name || creatorId;
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
      void queryClient.invalidateQueries({ queryKey: ["favorites", "creators"] });
      void queryClient.invalidateQueries({ queryKey: ["creator", service, creatorId] });
      void queryClient.invalidateQueries({ queryKey: ["creators"] });
    },
    onError: (error) => reportError(error, "Could not update favorite"),
  });
  const updated = details?.updated ?? summary?.updated;
  const favorited = summary?.favorited;
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

          <div className="mt-5 flex gap-1 border-b border-line/60">
            {(
              [
                ["posts", "Posts"],
                ["about", "About & links"],
                ["announcements", "Announcements"],
              ] as Array<[Tab, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "relative px-3 py-2.5 text-xs font-medium transition",
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
          <SectionHeader
            eyebrow="Archive"
            title="Posts"
            description="Newest archived posts from this creator."
          />
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
                postItems.length === 0
                  ? "No visible posts"
                  : "No posts match your filters"
              }
              message={
                postItems.length === 0
                  ? "The archive has no posts for this creator, or your content filters hid them."
                  : "Adjust or clear this creator's custom filters to see more posts."
              }
              action={
                creatorFilterActive(effectiveFilter) ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      updateFilter({
                        audioOnly: false,
                        hideNoMedia: false,
                        keywords: [],
                        asmr: false,
                      });
                      setKeywordText("");
                    }}
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
        <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-2xl border border-line/70 bg-surface/40 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              About
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted">
              {details?.description?.trim() ||
                "The archive does not expose a written description for this creator."}
            </p>
            <div className="mt-6 border-t border-line/60 pt-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                <Link2 className="h-3.5 w-3.5" /> Linked accounts
              </p>
              {links.isLoading ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <Spinner className="h-4 w-4" /> Loading links…
                </div>
              ) : links.isError ? (
                <p className="mt-3 text-xs text-muted">
                  {errorMessage(links.error)}
                </p>
              ) : links.data && links.data.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {links.data.map((link) => (
                    <button
                      key={`${link.service}:${link.id}`}
                      type="button"
                      onClick={() =>
                        navigate({
                          name: "creator",
                          service: link.service,
                          creatorId: link.id,
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-xl border border-line/60 bg-base/20 px-3 py-2.5 text-left transition hover:border-accent/30 hover:bg-base/40"
                    >
                      <CreatorAvatar
                        service={link.service}
                        id={link.id}
                        name={link.name}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {link.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {serviceLabel(link.service)}
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-muted" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  No linked accounts are available.
                </p>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-line/70 bg-base/25 p-4 text-[10px] text-muted">
              <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em]">
                Creator details
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt>Service</dt>
                  <dd className="text-ink">{serviceLabel(service)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Creator ID</dt>
                  <dd className="max-w-36 truncate text-ink">{creatorId}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Indexed</dt>
                  <dd className="text-ink">{formatDate(summary?.indexed)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Updated</dt>
                  <dd className="text-ink">{formatDate(updated)}</dd>
                </div>
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/[0.055] p-3 text-[10px] leading-relaxed text-accent/80">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Descriptions and links are shown only when the archive provides them.
            </div>
          </aside>
        </section>
      ) : null}

      {tab === "announcements" ? (
        <section className="mt-6">
          <SectionHeader
            eyebrow="From the creator"
            title="Announcements"
            description="Public announcements archived by Pawchive."
          />
          {announcements.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : announcements.isError ? (
            <EmptyState
              icon={Bell}
              title="Announcements unavailable"
              message={errorMessage(announcements.error)}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void announcements.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : announcements.data && announcements.data.length > 0 ? (
            <div className="space-y-3">
              {announcements.data.map((announcement) => (
                <article
                  key={announcement.hash}
                  className="rounded-xl border border-line/70 bg-surface/40 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-muted">
                    <Badge tone="accent">Announcement</Badge>
                    <span>{formatDate(announcement.added)}</span>
                  </div>
                  <SanitizedHtml
                    html={announcement.content}
                    className="text-xs leading-6 text-muted"
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Bell}
              title="No announcements"
              message="This creator has no archived announcements."
            />
          )}
        </section>
      ) : null}

      <Modal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Creator filters"
        description={`Customize which posts appear for ${name}.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                updateFilter({
                  audioOnly: false,
                  hideNoMedia: false,
                  keywords: [],
                  asmr: false,
                });
                setKeywordText("");
              }}
            >
              Clear filters
            </Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Toggle
            checked={isAsmr}
            onChange={(checked) =>
              updateFilter({
                ...filter,
                asmr: checked,
                audioOnly: checked ? true : false,
              })
            }
            label="ASMR creator"
            description={
              detectedAsmr
                ? "Detected automatically from this creator's name, profile or posts. Audio-only is applied."
                : "Manually mark this creator as ASMR and enable audio-only."
            }
          />
          <Toggle
            checked={effectiveFilter.audioOnly}
            onChange={(checked) => {
              if (autoAudioOnly && !checked) {
                updateFilter({ ...filter, asmr: false, audioOnly: false });
              } else {
                updateFilter({ ...filter, audioOnly: checked });
              }
            }}
            label="Audio only"
            description={
              autoAudioOnly
                ? "Auto-enabled because this creator is marked as ASMR."
                : "Only show posts that include an audio attachment."
            }
          />
          <Toggle
            checked={filter.hideNoMedia}
            onChange={(checked) =>
              updateFilter({ ...filter, hideNoMedia: checked })
            }
            label="Hide posts without media"
            description="Hide text-only posts that have no attachment or link."
          />
          <Field
            label="Hide keywords"
            hint="Separate with commas or new lines. Matching posts are hidden for this creator."
          >
            <textarea
              value={keywordText}
              onChange={(event) => {
                const value = event.target.value;
                setKeywordText(value);
                updateFilter({
                  ...filter,
                  keywords: parseFilterKeywords(value),
                });
              }}
              rows={3}
              placeholder="sketch, commission, teaser"
              className="w-full resize-y rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none transition placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
            />
          </Field>
          <p className="text-[10px] leading-relaxed text-dim">
            Filters are saved on this device and apply to this creator's post
            list. Direct post links still open normally.
          </p>
        </div>
      </Modal>
    </div>
  );
}
