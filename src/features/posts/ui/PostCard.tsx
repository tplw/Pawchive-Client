import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Film,
  Headphones,
  Image as ImageIcon,
  Layers,
  Music2,
  Play,
} from "lucide-react";
import { useEffect, useState } from "react";
import { queryKeys } from "../../../shared/query/keys";
import { cn, formatDate } from "../../../shared/lib/format";
import { activate } from "../../../shared/lib/a11y";
import { useInView } from "../../../shared/lib/useInView";
import { navigate } from "../../../shared/lib/router";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import type { MediaKind, PostSummary } from "../../../shared/types";
import { Skeleton } from "../../../shared/ui";
import {
  NotImportedBadge,
  ServiceBadge,
} from "../../creators/ui/CreatorVisuals";
import { ExceedsLimitBadge } from "./PostVisuals";

const KIND_ICONS: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music2,
  document: FileText,
  other: Layers,
};

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
    queryKey: queryKeys.postSummary(post.service, post.user, post.id),
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
            {post.imported === false ? (
              <NotImportedBadge className="shrink-0 px-1 py-0 text-[8px]" />
            ) : null}
            {post.exceedsLimit ? (
              <ExceedsLimitBadge className="shrink-0 px-1 py-0 text-[8px]" />
            ) : null}
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
        <div className="flex flex-wrap items-center gap-2">
          <ServiceBadge service={post.service} />
          <span className="text-[10px] text-muted">
            {formatDate(post.published ?? post.added)}
          </span>
          {post.imported === false ? (
            <NotImportedBadge className="px-1 py-0 text-[8px]" />
          ) : null}
          {post.exceedsLimit ? (
            <ExceedsLimitBadge className="px-1 py-0 text-[8px]" />
          ) : null}
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

