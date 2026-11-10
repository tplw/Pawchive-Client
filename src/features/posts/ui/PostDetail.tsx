import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Download,
  ExternalLink,
  Play,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../../shared/api";
import { errorMessage, isAppError, serviceLabel } from "../../../shared/lib/constants";
import {
  formatDate,
  formatDateTime,
  formatRelative,
} from "../../../shared/lib/format";
import { goBack, navigate } from "../../../shared/lib/router";
import { useAppStore } from "../../../app/store";
import { usePlayerStore } from "../../player/model/store";
import {
  CreatorAvatar,
  NotImportedBadge,
  ServiceBadge,
} from "../../creators/ui/CreatorVisuals";
import { ImageViewer } from "../../media/ui/ImageViewer";
import { PlaylistPicker } from "../../playlists/ui/PlaylistPicker";
import { SanitizedHtml } from "../../../shared/SanitizedHtml";
import { BlockedCreatorNotice } from "../../creators/ui/BlockedCreatorNotice";
import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { queryKeys } from "../../../shared/query/keys";
import { PostAttachments } from "./PostAttachments";
import { PostDiscussion } from "./PostDiscussion";
import { neighborForPost } from "../model/postNavigation";
import { useDownloadActions } from "../../downloads/model/useDownloadActions";
import { queueItemFromAttachment } from "../../player/model/queue";
import { Badge, Button, EmptyState, Spinner } from "../../../shared/ui";
import type { Attachment, PlaylistItemInput } from "../../../shared/types";

export function PostDetailPage({
  service,
  creatorId,
  postId,
}: {
  service: string;
  creatorId: string;
  postId: string;
}) {
  const blocked = useAppStore((state) =>
    isCreatorBlocked(state.settings.blockedCreators ?? [], service, creatorId),
  );
  if (blocked) return <BlockedCreatorNotice service={service} id={creatorId} />;
  return (
    <PostDetailContent
      service={service}
      creatorId={creatorId}
      postId={postId}
    />
  );
}

function PostDetailContent({
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
  const config = useAppStore((state) => state.config);
  const previousRoute = useAppStore((state) => state.previousRoute);
  const playItems = usePlayerStore((state) => state.playItems);
  const enqueue = usePlayerStore((state) => state.enqueue);
  const { startDownload, downloadPost: startPostDownload } =
    useDownloadActions();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [playlistItem, setPlaylistItem] = useState<PlaylistItemInput | null>(null);
  const [navigating, setNavigating] = useState(false);

  const post = useQuery({
    queryKey: queryKeys.post(service, creatorId, postId),
    queryFn: ({ signal }) =>
      api.getPost({ service, creatorId, postId, signal }),
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
      mediaUrl: attachment.downloadUrl ?? attachment.url,
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
      await startDownload({
        url: attachment.downloadUrl ?? attachment.url,
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
      const count = await startPostDownload(service, creatorId, postId);
      toast("success", "Download started", `${count} file${count === 1 ? "" : "s"} queued.`);
    } catch (error) {
      reportError(error, "Could not download post");
    }
  };

  const openFile = async (attachment: Attachment) => {
    try {
      await api.openExternal(attachment.downloadUrl ?? attachment.url);
    } catch (error) {
      reportError(error, "Could not open this file");
    }
  };

  const openImporter = async () => {
    try {
      await api.openExternal(
        `${config.staticBase.replace(/\/$/, "")}/importer`,
      );
    } catch (error) {
      reportError(error, "Could not open the importer");
    }
  };

  const previousPostId = detail
    ? neighborForPost({
        service,
        creatorId,
        postId,
        direction: -1,
        fallbackId: detail.prev ?? null,
      })
    : null;
  const nextPostId = detail
    ? neighborForPost({
        service,
        creatorId,
        postId,
        direction: 1,
        fallbackId: detail.next ?? null,
      })
    : null;

  const postNotFound = isAppError(post.error) && post.error.code === "not_found";
  const isNotImportedPost =
    detail?.post.origin?.trim().toLowerCase() === "kemono";
  const exceedsLimit = Boolean(
    detail && !isNotImportedPost && detail.post.has_full === false,
  );

  if (navigating || post.isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
        <Spinner />
        <p className="text-xs">Loading post…</p>
      </div>
    );
  }

  if (post.isError || !detail) {
    if (postNotFound) {
      return (
        <div className="pb-10">
          <button
            type="button"
            onClick={() => goBack({ name: "creator", service, creatorId })}
            className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-muted transition hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
          </button>
          <EmptyState
            icon={AlertTriangle}
            title="This post hasn't been archived yet"
            message="haven't archived this post yet. have a subscription? use the importer!"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => void openImporter()}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open importer
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => goBack({ name: "creator", service, creatorId })}
                >
                  {backLabel}
                </Button>
              </div>
            }
          />
        </div>
      );
    }
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

      {nextPostId || previousPostId ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {previousPostId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openPost(previousPostId)}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous post
            </Button>
          ) : (
            <span />
          )}
          {nextPostId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openPost(nextPostId)}
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
              {detail.creator?.ever_imported === false ? (
                <NotImportedBadge creator />
              ) : null}
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

        {isNotImportedPost ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-base/30 px-4 py-3 text-xs text-muted">
            <AlertTriangle className="h-4 w-4 shrink-0 text-favorite" />
            <span>
              haven't archived this post yet. have a subscription? use the{" "}
              <button
                type="button"
                onClick={() => void openImporter()}
                className="font-semibold text-accent underline underline-offset-2 transition hover:text-ink"
              >
                importer
              </button>
              !
            </span>
          </div>
        ) : null}

        {exceedsLimit ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#e0483d]/35 bg-[#e0483d]/10 px-4 py-3 text-xs text-[#e0483d]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Some files exceed the archive size limit and weren't saved
            </span>
          </div>
        ) : null}

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

            <PostAttachments
              count={detail.attachments.length}
              images={images}
              playable={playable}
              documents={documents}
              disabled={isNotImportedPost}
              onViewImage={setViewerIndex}
              onPlay={play}
              onQueue={queueAttachment}
              onAddToPlaylist={addToPlaylist}
              onDownload={(attachment) => void downloadAttachment(attachment)}
              onOpenFile={(attachment) => void openFile(attachment)}
            />

            <PostDiscussion
              service={service}
              creatorId={creatorId}
              postId={postId}
            />
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
