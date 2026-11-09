import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { creatorNameLooksAsmr, loadCreatorFilter } from "../../../shared/lib/creatorFilters";
import { queryKeys } from "../../../shared/query/keys";
import { cn, formatRelative, shortNumber } from "../../../shared/lib/format";
import { activate } from "../../../shared/lib/a11y";
import { navigate } from "../../../shared/lib/router";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import type { CreatorSummary } from "../../../shared/types";
import { Badge, Skeleton } from "../../../shared/ui";
import { SiteIcon } from "../../../shared/SiteIcon";
import {
  CreatorAvatar,
  CreatorBanner,
  NotImportedBadge,
  ServiceBadge,
} from "./CreatorVisuals";

export function CreatorCard({ creator }: { creator: CreatorSummary }) {
  const queryClient = useQueryClient();
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  const showCreatorUpdated = useAppStore(
    (state) => state.settings.showCreatorUpdated,
  );
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);

  const favorite = useMutation({
    mutationFn: (favorited: boolean) =>
      api.setFavoriteCreator({
        service: creator.service,
        creatorId: creator.id,
        name: creator.name,
        publicId: creator.public_id ?? null,
        favorited,
      }),
    onSuccess: (favorited) => {
      toast(
        "success",
        favorited ? "Creator added to favorites" : "Creator removed from favorites",
        creator.name,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesCreators() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creators() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creator(creator.service, creator.id) });
    },
    onError: (error) => reportError(error, "Could not update favorite"),
  });

  const open = () =>
    navigate({
      name: "creator",
      service: creator.service,
      creatorId: creator.id,
    });
  const savedAsmr = loadCreatorFilter(creator.service, creator.id).asmr;
  const isAsmr = savedAsmr ?? creatorNameLooksAsmr(creator.name);

  if (cardSize === "small") {
    return (
      <article
        role="link"
        tabIndex={0}
        aria-label={`Open ${creator.name}`}
        onClick={open}
        onKeyDown={(event) => activate(event, open)}
        className="site-card relative flex h-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl2 border border-line/80 bg-card px-3 py-2.5"
      >
        <div className="absolute inset-0">
          <CreatorBanner
            service={creator.service}
            id={creator.id}
            name={creator.name}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/25" />
        </div>
        <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3">
          <CreatorAvatar
            service={creator.service}
            id={creator.id}
            name={creator.name}
            size="md"
            className="ring-2 ring-black/30"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-white">
              {creator.name || creator.id}
            </h3>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <ServiceBadge service={creator.service} />
              {isAsmr ? (
                <Badge tone="accent" className="shrink-0 px-1 py-0 text-[8px]">
                  ASMR
                </Badge>
              ) : null}
              {creator.ever_imported === false ? (
                <NotImportedBadge
                  creator
                  className="shrink-0 px-1 py-0 text-[8px]"
                />
              ) : null}
              <span className="truncate text-[10px] text-white/60">
                {showCreatorUpdated && creator.updated
                  ? `Updated ${formatRelative(creator.updated)}`
                  : creator.favorited
                    ? `${shortNumber(creator.favorited)} favorites`
                    : "Pawchive creator"}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={
            creator.is_favorite ? "Remove creator from favorites" : "Favorite creator"
          }
          title={creator.is_favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={(event) => {
            event.stopPropagation();
            favorite.mutate(!creator.is_favorite);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={favorite.isPending}
          className={cn(
            "relative z-20 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition",
            creator.is_favorite
              ? "border-favorite/40 bg-favorite/15"
              : "border-white/10 bg-black/45 hover:border-favorite/40 hover:bg-black/65",
          )}
        >
          <SiteIcon
            name="favorites"
            size={16}
            tone={creator.is_favorite ? "favorite" : "default"}
          />
        </button>
      </article>
    );
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`Open ${creator.name}`}
      onClick={open}
      onKeyDown={(event) => activate(event, open)}
      className="site-card group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl2 border border-line/80 bg-card"
    >
      <div className="relative h-24 shrink-0 overflow-hidden">
        <CreatorBanner
          service={creator.service}
          id={creator.id}
          name={creator.name}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
        <button
          type="button"
          aria-label={
            creator.is_favorite ? "Remove creator from favorites" : "Favorite creator"
          }
          title={creator.is_favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={(event) => {
            event.stopPropagation();
            favorite.mutate(!creator.is_favorite);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={favorite.isPending}
          className={cn(
            "absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg border transition",
            creator.is_favorite
              ? "border-favorite/40 bg-favorite/15"
              : "border-white/10 bg-black/45 hover:border-favorite/40 hover:bg-black/65",
          )}
        >
          <SiteIcon
            name="favorites"
            size={16}
            tone={creator.is_favorite ? "favorite" : "default"}
            className={creator.is_favorite ? undefined : "opacity-80"}
          />
        </button>
      </div>
      <div className="relative -mt-8 flex flex-1 flex-col px-4 pb-4">
        <CreatorAvatar
          service={creator.service}
          id={creator.id}
          name={creator.name}
          size="lg"
          className="ring-4 ring-card"
        />
        <h3 className="mt-2 truncate text-sm font-bold text-ink">
          {creator.name || creator.id}
        </h3>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <ServiceBadge service={creator.service} />
          {isAsmr ? (
            <Badge tone="accent" className="shrink-0 px-1 py-0 text-[8px]">
              ASMR
            </Badge>
          ) : null}
          {creator.ever_imported === false ? (
            <NotImportedBadge creator className="shrink-0 px-1 py-0 text-[8px]" />
          ) : null}
          {creator.updated ? (
            <span className="truncate text-[10px] text-muted">
              Updated {formatRelative(creator.updated)}
            </span>
          ) : null}
        </div>
        <div className="mt-auto flex items-center gap-1.5 pt-3 text-[10px] text-muted">
          <Users className="h-3 w-3 text-accent/70" />
          {creator.favorited
            ? `${shortNumber(creator.favorited)} archive favorites`
            : "Pawchive creator"}
        </div>
      </div>
    </article>
  );
}

export function CreatorCardSkeleton() {
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  if (cardSize === "small") {
    return (
      <div className="flex h-full items-center gap-3 overflow-hidden rounded-xl2 border border-line/70 bg-card px-3">
        <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
    );
  }
  return (
    <div className="h-full overflow-hidden rounded-xl2 border border-line/70 bg-card p-4">
      <Skeleton className="h-20 w-full" />
      <div className="-mt-7 flex items-end justify-between">
        <Skeleton className="h-16 w-16 rounded-lg ring-4 ring-card" />
      </div>
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <Skeleton className="mt-3 h-3 w-1/2" />
    </div>
  );
}

