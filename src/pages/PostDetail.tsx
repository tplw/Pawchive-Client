import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  Film,
  Headphones,
  Image as ImageIcon,
  ListMusic,
  ListPlus,
  MessageSquare,
  Play,
  Quote,
  RotateCw,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { errorMessage, serviceLabel } from "../lib/constants";
import {
  cn,
  formatBytes,
  formatDate,
  formatDateTime,
  formatRelative,
} from "../lib/format";
import { goBack, navigate } from "../lib/router";
import { useAppStore } from "../stores/app";
import { usePlayerStore } from "../player/store";
import { CreatorAvatar, ServiceBadge } from "../components/cards";
import { ImageViewer } from "../components/ImageViewer";
import { PlaylistPicker } from "../components/PlaylistPicker";
import { SanitizedHtml } from "../components/SanitizedHtml";
import { queueItemFromAttachment } from "../player/queue";
import { Badge, Button, EmptyState, IconButton, SectionHeader, Spinner } from "../components/ui";
import type { Attachment, MediaKind, PlaylistItemInput } from "../types";

type Tab = "comments" | "revisions";

const mediaSizeCache = new Map<string, Promise<number | null>>();
const resolutionCache = new Map<
  string,
  { width: number; height: number } | null
>();

function mediaSize(url: string): Promise<number | null> {
  const cached = mediaSizeCache.get(url);
  if (cached) return cached;
  const pending = api.getMediaSize(url).catch(() => null);
  mediaSizeCache.set(url, pending);
  return pending;
}

function videoResolution(
  url: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const finish = (size: { width: number; height: number } | null) => {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Best-effort decoder release.
      }
      resolve(size);
    };
    video.onloadedmetadata = () => {
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function AttachmentMeta({
  attachment,
  className,
}: {
  attachment: Attachment;
  className?: string;
}) {
  const [size, setSize] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mediaSize(attachment.url).then((value) => {
      if (!cancelled) setSize(value);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.url]);

  useEffect(() => {
    if (attachment.kind !== "video" && attachment.kind !== "image") return;
    let cancelled = false;
    const key = `${attachment.kind}:${attachment.url}`;
    const cached = resolutionCache.get(key);
    if (cached !== undefined) {
      setResolution(cached);
      return;
    }
    const load =
      attachment.kind === "video"
        ? videoResolution(attachment.url)
        : api
            .getImageDimensions(attachment.url)
            .then((value) => value ?? null)
            .catch(() => null);
    void load.then((value) => {
      resolutionCache.set(key, value);
      if (!cancelled) setResolution(value);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.kind, attachment.thumbnailUrl, attachment.url]);

  const parts: string[] = [];
  if (resolution) parts.push(`${resolution.width}×${resolution.height}`);
  if (size) parts.push(formatBytes(size));
  if (parts.length === 0) return null;
  return (
    <span
      className={cn(
        "mt-0.5 block text-[9px] tabular-nums text-dim",
        className,
      )}
    >
      {parts.join(" · ")}
    </span>
  );
}

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Headphones,
  document: FileText,
  other: FileText,
};

export function PostDetailPage({
  service,
  creatorId,
  postId,
}: {
  service: string;
  creatorId: string;
  postId: string;
}) {
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const previousRoute = useAppStore((state) => state.previousRoute);
  const playItems = usePlayerStore((state) => state.playItems);
  const enqueue = usePlayerStore((state) => state.enqueue);
  const [tab, setTab] = useState<Tab>("comments");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [playlistItem, setPlaylistItem] = useState<PlaylistItemInput | null>(null);
  const [navigating, setNavigating] = useState(false);

  const post = useQuery({
    queryKey: ["post", service, creatorId, postId],
    queryFn: ({ signal }) =>
      api.getPost({ service, creatorId, postId, signal }),
    staleTime: 120_000,
  });
  const comments = useQuery({
    queryKey: ["comments", service, creatorId, postId],
    queryFn: ({ signal }) =>
      api.getPostComments({ service, creatorId, postId, signal }),
    enabled: tab === "comments",
    staleTime: 60_000,
  });
  const revisions = useQuery({
    queryKey: ["revisions", service, creatorId, postId],
    queryFn: ({ signal }) =>
      api.getPostRevisions({ service, creatorId, postId, signal }),
    enabled: tab === "revisions",
    staleTime: 120_000,
  });

  const detail = post.data;
  const images = useMemo(
    () => detail?.attachments.filter((attachment) => attachment.kind === "image") ?? [],
    [detail],
  );
  const downloadable = useMemo(
    () => detail?.attachments.filter((attachment) => !attachment.previewOnly) ?? [],
    [detail],
  );
  const playable = useMemo(
    () =>
      detail?.attachments.filter(
        (attachment) =>
          attachment.kind === "video" || attachment.kind === "audio",
      ) ?? [],
    [detail],
  );
  const documents = useMemo(
    () =>
      detail?.attachments.filter(
        (attachment) =>
          attachment.kind === "document" || attachment.kind === "other",
      ) ?? [],
    [detail],
  );
  const creatorName = detail?.creator?.name ?? creatorId;
  const backLabel =
    previousRoute?.name === "discover"
      ? "Back to discover"
      : previousRoute?.name === "search"
        ? "Back to search"
        : previousRoute?.name === "home"
          ? "Back to playlists"
          : previousRoute?.name === "creators"
            ? "Back to creators"
            : previousRoute?.name === "playlist"
              ? "Back to playlist"
              : previousRoute?.name === "post"
                ? "Back to post"
                : `Back to ${creatorName}`;

  const openPost = (nextPostId: string) => {
    setNavigating(true);
    navigate({
      name: "post",
      service,
      creatorId,
      postId: nextPostId,
    });
  };

  const play = (attachment: Attachment) => {
    if (!detail) return;
    const items = playable.map((entry) =>
      queueItemFromAttachment(entry, {
        title: detail.post.title || entry.name,
        creatorName,
        artwork: images[0]?.thumbnailUrl ?? null,
        service,
        creatorId,
        postId,
      }),
    );
    const index = playable.findIndex((entry) => entry.path === attachment.path);
    playItems(items, Math.max(index, 0));
  };

  const queueAttachment = (attachment: Attachment) => {
    if (!detail) return;
    enqueue([
      queueItemFromAttachment(attachment, {
        title: detail.post.title || attachment.name,
        creatorName,
        artwork: images[0]?.thumbnailUrl ?? null,
        service,
        creatorId,
        postId,
      }),
    ]);
  };

  const addToPlaylist = (attachment: Attachment) => {
    if (!detail) return;
    setPlaylistItem({
      service,
      creatorId,
      postId,
      mediaPath: attachment.path,
      mediaUrl: attachment.url,
      title: detail.post.title || attachment.name,
      creatorName,
      thumbnailUrl:
        attachment.thumbnailUrl ?? images[0]?.thumbnailUrl ?? null,
      mediaKind: attachment.kind,
    });
  };

  const downloadAttachment = async (attachment: Attachment) => {
    if (!detail) return;
    if (attachment.previewOnly) {
      toast(
        "info",
        "Preview only",
        "The full file is not available on the archive; open the post on Pawchive to download it.",
      );
      return;
    }
    try {
      await api.startDownload({
        url: attachment.url,
        fileName: attachment.name,
        title: detail.post.title || attachment.name,
        creatorName,
        service,
        creatorId,
        postId,
        thumbnailUrl: attachment.thumbnailUrl ?? images[0]?.thumbnailUrl ?? null,
        mediaKind: attachment.kind,
      });
      toast("success", "Download started", attachment.name);
    } catch (error) {
      reportError(error, "Could not start download");
    }
  };

  const downloadPost = async () => {
    try {
      const count = await api.downloadPost(service, creatorId, postId);
      toast("success", "Download started", `${count} file${count === 1 ? "" : "s"} queued.`);
    } catch (error) {
      reportError(error, "Could not download post");
    }
  };

  const openFile = async (attachment: Attachment) => {
    try {
      await api.openExternal(attachment.url);
    } catch (error) {
      reportError(error, "Could not open this file");
    }
  };

  if (navigating || post.isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
        <Spinner />
        <p className="text-xs">Loading post…</p>
      </div>
    );
  }

  if (post.isError || !detail) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Could not open this post"
        message={errorMessage(post.error)}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void post.refetch()}>
              Try again
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                goBack({ name: "creator", service, creatorId })
              }
            >
              {backLabel}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="pb-10">
      <button
        type="button"
        onClick={() => goBack({ name: "creator", service, creatorId })}
        className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </button>

      {detail.next || detail.prev ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {detail.prev ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openPost(detail.prev ?? "")}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous post
            </Button>
          ) : (
            <span />
          )}
          {detail.next ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openPost(detail.next ?? "")}
            >
              Next post <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <article className="rounded-2xl border border-line/70 bg-surface/45 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <ServiceBadge service={service} />
          <span className="inline-flex items-center gap-1 text-[10px] text-muted">
            <CalendarDays className="h-3 w-3" />{" "}
            {formatDateTime(detail.post.published ?? detail.post.added)}
          </span>
          {detail.post.edited ? (
            <span className="text-[10px] text-muted">
              Edited {formatRelative(detail.post.edited)}
            </span>
          ) : null}
          {detail.post.shared_file ? <Badge>Shared file</Badge> : null}
        </div>

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 sm:flex-1">
            <h1 className="break-words text-xl font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere] sm:text-2xl">
              {detail.post.title || "Untitled post"}
            </h1>
            <button
              type="button"
              onClick={() => navigate({ name: "creator", service, creatorId })}
              className="mt-2 inline-flex items-center gap-2 text-xs text-muted transition hover:text-ink"
            >
              <CreatorAvatar
                service={service}
                id={creatorId}
                name={creatorName}
                size="xs"
              />
              {creatorName}
            </button>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {playable.length > 0 ? (
              <Button variant="primary" onClick={() => play(playable[0])}>
                <Play className="h-4 w-4" fill="currentColor" /> Play media
              </Button>
            ) : null}
            {downloadable.length > 0 ? (
              <Button variant="secondary" onClick={() => void downloadPost()}>
                <Download className="h-4 w-4" /> Download post
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            {detail.post.content ? (
              <SanitizedHtml
                html={detail.post.content}
                className="max-w-none text-sm leading-7 text-muted"
              />
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-xs text-muted">
                This post has no written description.
              </p>
            )}

            {detail.attachments.length > 0 ? (
              <section className="mt-7">
                <SectionHeader
                  eyebrow={`${detail.attachments.length} attachment${detail.attachments.length === 1 ? "" : "s"}`}
                  title="Attachments"
                  description="Images open in the viewer; audio and video play in the built-in player."
                />

                {images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.map((attachment) => (
                      <div
                        key={attachment.path}
                        className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-line/70 bg-elevated/60"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setViewerIndex(
                              images.findIndex((entry) => entry.path === attachment.path),
                            )
                          }
                          className="block h-full w-full text-left"
                        >
                          {attachment.thumbnailUrl ? (
                            <img
                              src={attachment.thumbnailUrl}
                              alt={attachment.name}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <span className="grid h-full w-full place-items-center">
                              <ImageIcon className="h-7 w-7 text-accent/45" />
                            </span>
                          )}
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
                            <span className="block truncate text-[10px] text-white/80">
                              {attachment.name}
                            </span>
                            <AttachmentMeta
                              attachment={attachment}
                              className="text-white/45"
                            />
                          </span>
                        </button>
                        <div className="touch-visible absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                          <IconButton
                            label={`Add ${attachment.name} to playlist`}
                            icon={ListPlus}
                            size="sm"
                            className="bg-black/60 text-white hover:bg-accent hover:text-black"
                            onClick={() => addToPlaylist(attachment)}
                          />
                          {!attachment.previewOnly ? (
                            <IconButton
                              label={`Download ${attachment.name}`}
                              icon={Download}
                              size="sm"
                              className="bg-black/60 text-white hover:bg-accent hover:text-black"
                              onClick={() => void downloadAttachment(attachment)}
                            />
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {playable.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {playable.map((attachment) => {
                      const Icon = KIND_ICON[attachment.kind];
                      return (
                        <div
                          key={attachment.path}
                          className="group flex w-full items-center gap-3 rounded-lg border border-line/70 bg-base/20 px-3 py-2.5 transition hover:border-accent/30 hover:bg-base/40"
                        >
                          <button
                            type="button"
                            onClick={() => play(attachment)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold text-ink">
                                {attachment.name}
                              </span>
                              <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-muted">
                                {attachment.kind}
                                {attachment.previewOnly ? " · preview only" : ""}
                              </span>
                              <AttachmentMeta attachment={attachment} />
                            </span>
                          </button>
                          <div className="flex items-center gap-0.5">
                            <IconButton
                              label="Add to queue"
                              icon={ListMusic}
                              size="sm"
                              onClick={() => queueAttachment(attachment)}
                            />
                            <IconButton
                              label="Add to playlist"
                              icon={ListPlus}
                              size="sm"
                              onClick={() => addToPlaylist(attachment)}
                            />
                            {!attachment.previewOnly ? (
                              <IconButton
                                label="Download"
                                icon={Download}
                                size="sm"
                                onClick={() => void downloadAttachment(attachment)}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {documents.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {documents.map((attachment) => (
                      <div
                        key={attachment.path}
                        className="flex w-full items-center gap-3 rounded-lg border border-line/70 bg-base/20 px-3 py-2.5 transition hover:border-accent/30 hover:bg-base/40"
                      >
                        <button
                          type="button"
                          onClick={() => void openFile(attachment)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-muted">
                            <FileText className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-ink">
                              {attachment.name}
                            </span>
                            <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-muted">
                              {attachment.kind}
                            </span>
                            <AttachmentMeta attachment={attachment} />
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted" />
                        </button>
                        {!attachment.previewOnly ? (
                          <IconButton
                            label="Download"
                            icon={Download}
                            size="sm"
                            onClick={() => void downloadAttachment(attachment)}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="mt-8">
              <div className="mb-3 flex gap-1 border-b border-line/60">
                <button
                  type="button"
                  onClick={() => setTab("comments")}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition",
                    tab === "comments" ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Comments
                  {comments.data?.length ? (
                    <span className="rounded-full bg-accent/12 px-1.5 py-0.5 text-[9px] text-accent">
                      {comments.data.length}
                    </span>
                  ) : null}
                  {tab === "comments" ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("revisions")}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition",
                    tab === "revisions" ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  <RotateCw className="h-3.5 w-3.5" /> Revisions
                  {tab === "revisions" ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />
                  ) : null}
                </button>
              </div>

              {tab === "comments" ? (
                comments.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : comments.isError ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="Comments unavailable"
                    message={errorMessage(comments.error)}
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => void comments.refetch()}
                      >
                        Try again
                      </Button>
                    }
                  />
                ) : comments.data?.length ? (
                  <div className="space-y-2">
                    {comments.data.map((comment) => (
                      <article
                        key={comment.id}
                        className={cn(
                          "rounded-xl border border-line/60 bg-base/20 p-3.5",
                          comment.parent_id &&
                            "ml-5 border-l-2 border-l-accent/30",
                        )}
                      >
                        <div className="mb-1.5 flex items-center gap-2 text-[10px] text-muted">
                          <UserRound className="h-3 w-3" />
                          <span className="font-medium text-ink">
                            {comment.commenter_name || comment.commenter}
                          </span>
                          <span>· {formatRelative(comment.published)}</span>
                          {comment.parent_id ? (
                            <span className="inline-flex items-center gap-1 text-accent/70">
                              <Quote className="h-2.5 w-2.5" /> reply
                            </span>
                          ) : null}
                          {comment.revisions.length ? (
                            <span className="ml-auto">
                              {comment.revisions.length} edits
                            </span>
                          ) : null}
                        </div>
                        <SanitizedHtml
                          html={comment.content}
                          className="text-xs leading-6 text-muted"
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={MessageSquare}
                    title="No comments"
                    message="The archive has no comments for this post."
                  />
                )
              ) : revisions.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : revisions.isError ? (
                <EmptyState
                  icon={RotateCw}
                  title="Revisions unavailable"
                  message={errorMessage(revisions.error)}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => void revisions.refetch()}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : revisions.data?.length ? (
                <div className="space-y-2">
                  {revisions.data.map((revision) => (
                    <article
                      key={revision.revision_id}
                      className="rounded-xl border border-line/60 bg-base/20 p-3.5"
                    >
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-muted">
                        <RotateCw className="h-3 w-3 text-accent/70" />
                        Revision {revision.revision_id}
                        <span>
                          ·{" "}
                          {formatRelative(
                            typeof revision.published === "number"
                              ? revision.published
                              : null,
                          )}
                        </span>
                      </div>
                      <h3 className="text-xs font-medium text-ink">
                        {typeof revision.title === "string" && revision.title
                          ? revision.title
                          : "Untitled revision"}
                      </h3>
                      <SanitizedHtml
                        html={
                          typeof revision.content === "string"
                            ? revision.content
                            : ""
                        }
                        className="mt-1 text-xs leading-6 text-muted"
                      />
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={RotateCw}
                  title="No revisions"
                  message="This post has not been edited in the archive."
                />
              )}
            </section>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-line/70 bg-base/25 p-4 text-[10px] text-muted">
              <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em]">
                Post details
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt>Published</dt>
                  <dd className="text-ink">
                    {formatDate(detail.post.published ?? detail.post.added)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Attachments</dt>
                  <dd className="text-ink">{detail.attachments.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Service</dt>
                  <dd className="text-ink">{serviceLabel(service)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Post ID</dt>
                  <dd className="max-w-32 truncate text-ink">{detail.post.id}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </article>

      {viewerIndex !== null && images.length > 0 ? (
        <ImageViewer
          images={images}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}

      {playlistItem ? (
        <PlaylistPicker
          open
          item={playlistItem}
          onClose={() => setPlaylistItem(null)}
        />
      ) : null}
    </div>
  );
}
