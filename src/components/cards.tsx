import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Film,
  Headphones,
  Image as ImageIcon,
  Layers,
  Music2,
  Play,
  Radio,
  Users,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  creatorAvatar,
  creatorBanner,
  serviceLabel,
} from "../lib/constants";
import { creatorNameLooksAsmr, loadCreatorFilter } from "../lib/creatorFilters";
import { cn, formatDate, formatRelative, shortNumber } from "../lib/format";
import { navigate } from "../lib/router";
import { useInView } from "../lib/useInView";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import type { CreatorSummary, MediaKind, PostSummary, Service } from "../types";
import { Badge, Skeleton } from "./ui";
import { SiteIcon } from "./SiteIcon";

const KIND_ICONS: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music2,
  document: FileText,
  other: Layers,
};

const SERVICE_COLORS: Record<string, string> = {
  patreon: "bg-[#f96854]/12 text-[#ff8a78] border-[#f96854]/25",
  fanbox: "bg-[#00a4e4]/12 text-[#5cc8f4] border-[#00a4e4]/25",
  discord: "bg-[#5865f2]/12 text-[#8c95ff] border-[#5865f2]/25",
};

function activate(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function CreatorAvatar({
  service,
  id,
  name,
  size = "md",
  className,
}: {
  service: Service;
  id: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const config = useAppStore((state) => state.config);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const sizes = {
    xs: "h-6 w-6 text-[9px]",
    sm: "h-9 w-9 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-16 w-16 text-lg",
    xl: "h-24 w-24 text-2xl",
  };
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, service]);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg border border-line/80 bg-elevated",
        sizes[size],
        className,
      )}
    >
      {!failed ? (
        <img
          src={creatorAvatar(config, service, id)}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="grid h-full w-full place-items-center font-semibold text-accent">
          {initials || <Radio className="h-4 w-4" />}
        </span>
      )}
    </div>
  );
}

export function CreatorBanner({
  service,
  id,
  name,
}: {
  service: Service;
  id: string;
  name: string;
}) {
  const config = useAppStore((state) => state.config);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, service]);
  if (failed) {
    return (
      <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgb(var(--accent)/0.22),transparent_45%),radial-gradient(circle_at_80%_70%,rgb(var(--accent)/0.1),transparent_40%)]" />
    );
  }
  return (
    <img
      src={creatorBanner(config, service, id)}
      alt={`${name} banner`}
      loading="lazy"
      decoding="async"
      className={cn(
        "h-full w-full object-cover transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0",
      )}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}

export function ServiceBadge({ service }: { service: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        SERVICE_COLORS[service.toLowerCase()] ?? "bg-white/7 text-muted border-white/10",
      )}
    >
      {serviceLabel(service)}
    </span>
  );
}

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
      void queryClient.invalidateQueries({ queryKey: ["favorites", "creators"] });
      void queryClient.invalidateQueries({ queryKey: ["creators"] });
      void queryClient.invalidateQueries({ queryKey: ["creator", creator.service, creator.id] });
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

export function PostCard({
  post,
  enrichMedia = false,
}: {
  post: PostSummary;
  enrichMedia?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  const { ref: cardRef, inView } = useInView<HTMLElement>();
  const needsEnrichment = Boolean(
    enrichMedia &&
      post.attachmentCount > 0 &&
      (post.mediaKinds?.length ?? 0) === 0,
  );
  const mediaInfo = useQuery({
    queryKey: ["post-summary", post.service, post.user, post.id],
    queryFn: () =>
      api.getPostSummary({
        service: post.service,
        creatorId: post.user,
        postId: post.id,
      }),
    enabled: needsEnrichment && inView,
    staleTime: 300_000,
  });
  const displayPost = mediaInfo.data
    ? {
        ...post,
        mediaKinds: mediaInfo.data.mediaKinds,
        attachmentCount: mediaInfo.data.attachmentCount,
      }
    : post;
  const kinds = displayPost.mediaKinds ?? [];
  const attachmentCount = displayPost.attachmentCount;

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [post.thumbnailUrl]);
  const open = () =>
    navigate({
      name: "post",
      service: post.service,
      creatorId: post.user,
      postId: post.id,
    });

  const thumbnail = (
    <>
      {post.thumbnailUrl && !imageFailed ? (
        <img
          src={post.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]",
            imageLoaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(var(--accent)/0.18),transparent_55%)]">
          {kinds.includes("video") ? (
            <Film className="h-8 w-8 text-accent/50" />
          ) : kinds.includes("audio") ? (
            <Headphones className="h-8 w-8 text-accent/50" />
          ) : (
            <FileText className="h-8 w-8 text-accent/50" />
          )}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
    </>
  );

  const mediaBadges = (
    <div className="flex items-center gap-1.5">
      {kinds.length > 0 ? (
        kinds.slice(0, 3).map((kind) => {
          const Icon = KIND_ICONS[kind] ?? FileText;
          return (
            <span
              key={kind}
              className="grid h-6 w-6 place-items-center rounded bg-black/70 text-white/80"
              title={kind}
            >
              <Icon className="h-3 w-3" />
            </span>
          );
        })
      ) : attachmentCount > 0 ? (
        <span
          className="grid h-6 w-6 place-items-center rounded bg-black/70 text-white/80"
          title="files"
        >
          <FileText className="h-3 w-3" />
        </span>
      ) : null}
      {attachmentCount > 0 ? (
        <span className="rounded bg-black/70 px-1.5 py-1 text-[10px] font-medium text-white/80">
          {attachmentCount}
        </span>
      ) : null}
    </div>
  );

  if (cardSize === "small") {
    return (
      <article
        ref={cardRef}
        role="link"
        tabIndex={0}
        aria-label={`Open ${post.title}`}
        data-card-size={cardSize}
        onClick={open}
        onKeyDown={(event) => activate(event, open)}
        className="site-card group relative aspect-square h-full cursor-pointer overflow-hidden rounded-xl2 border border-line/80 bg-card"
      >
        <div className="absolute inset-0 overflow-hidden">{thumbnail}</div>
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <ServiceBadge service={post.service} />
          {mediaBadges}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <h3 className="line-clamp-2 text-xs font-bold leading-snug text-white drop-shadow">
            {post.title || "Untitled post"}
          </h3>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[9px] text-white/65">
            <span className="truncate">
              {post.creatorName ?? "Unknown creator"}
            </span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      ref={cardRef}
      role="link"
      tabIndex={0}
      aria-label={`Open ${post.title}`}
      data-card-size={cardSize}
      onClick={open}
      onKeyDown={(event) => activate(event, open)}
      className="site-card group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl2 border border-line/80 bg-card"
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden",
          cardSize === "large" ? "aspect-[16/9]" : "aspect-[16/10]",
        )}
      >
        {thumbnail}
        <div className="absolute bottom-2 left-2">{mediaBadges}</div>
        {kinds.includes("video") || kinds.includes("audio") ? (
          <span className="touch-visible absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white/80 opacity-0 transition group-hover:opacity-100">
            <Play className="h-3 w-3" fill="currentColor" />
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "relative flex flex-1 flex-col",
          cardSize === "large" ? "p-4" : "p-3.5",
        )}
      >
        <div className="flex items-center gap-2">
          <ServiceBadge service={post.service} />
          <span className="text-[10px] text-muted">
            {formatDate(post.published ?? post.added)}
          </span>
        </div>
        <h3
          className={cn(
            "mt-2 line-clamp-2 font-bold leading-snug text-ink",
            cardSize === "large" ? "text-sm" : "text-[13px]",
          )}
        >
          {post.title || "Untitled post"}
        </h3>
        {post.excerpt ? (
          <p
            className={cn(
              "mt-1.5 leading-relaxed text-muted",
              cardSize === "large"
                ? "line-clamp-3 text-[12px]"
                : "line-clamp-2 text-[11px]",
            )}
          >
            {post.excerpt}
          </p>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-muted">
          <span className="truncate">{post.creatorName ?? "Unknown creator"}</span>
        </div>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  if (cardSize === "small") {
    return <Skeleton className="aspect-square h-full w-full rounded-xl2" />;
  }
  return (
    <div className="h-full overflow-hidden rounded-xl2 border border-line/70 bg-card">
      <Skeleton className="aspect-[16/10] w-full" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function MediaTypeIcon({ kind }: { kind: MediaKind }) {
  const Icon = KIND_ICONS[kind] ?? FileText;
  return <Icon className="h-4 w-4" />;
}

export function StatPill({
  icon: Icon,
  children,
}: {
  icon: typeof Users;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}
