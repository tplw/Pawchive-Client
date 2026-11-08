import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  ListPlus,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { errorMessage } from "../lib/constants";
import { isCreatorBlocked } from "../lib/blockedCreators";
import { cn, formatBytes, formatRelative } from "../lib/format";
import { useAppStore } from "../stores/app";
import { usePlayerStore } from "../player/store";
import { isPlayableMediaKind, providerForUrl } from "../player/queue";
import { isMobile } from "../lib/platform";
import { ImageViewer } from "../components/ImageViewer";
import { MediaThumbnail } from "../components/MediaThumbnail";
import { PlaylistPicker } from "../components/PlaylistPicker";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
} from "../components/ui";
import type { Attachment, DownloadRecord, PlaylistItemInput } from "../types";

const DOWNLOAD_CHUNK = 80;
let savedDownloadsVisible = DOWNLOAD_CHUNK;

const STATUS_LABEL: Record<DownloadRecord["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const DownloadRow = memo(function DownloadRow({
  record,
}: {
  record: DownloadRecord;
}) {
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const playItems = usePlayerStore((state) => state.playItems);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = record.status === "queued" || record.status === "downloading";
  const playable = isPlayableMediaKind(record.mediaKind);
  const canOpen = record.status === "completed" && (playable || record.mediaKind === "image");
  const percent =
    record.totalBytes && record.totalBytes > 0
      ? Math.min(100, (record.downloadedBytes / record.totalBytes) * 100)
      : null;

  useEffect(() => {
    let cancelled = false;
    if (record.status === "completed" && record.mediaKind === "image") {
      void api
        .localMediaUrl(record.filePath)
        .then((url) => {
          if (!cancelled) setLocalUrl(url);
        })
        .catch(() => undefined);
    } else {
      setLocalUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [record.filePath, record.mediaKind, record.status]);

  const image = useMemo<Attachment>(
    () => ({
      name: record.title || record.fileName,
      path: record.filePath,
      url: localUrl ?? record.thumbnailUrl ?? record.url,
      thumbnailUrl: record.thumbnailUrl ?? record.url,
      kind: "image",
      provider: providerForUrl(record.url),
      ext: record.fileName.split(".").pop() ?? "",
      previewOnly: false,
    }),
    [
      localUrl,
      record.fileName,
      record.filePath,
      record.thumbnailUrl,
      record.title,
      record.url,
    ],
  );

  const cancel = useMutation({
    mutationFn: () => api.cancelDownload(record.id),
    onSuccess: () => {
      toast("info", "Download cancelled", record.fileName);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
    onError: (error) => reportError(error, "Could not cancel download"),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDownload(record.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
    onError: (error) => reportError(error, "Could not delete download"),
  });

  const retry = useMutation({
    mutationFn: () => api.retryDownload(record.id),
    onSuccess: () => {
      toast("info", "Download requeued", record.fileName);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
    onError: (error) => reportError(error, "Could not retry download"),
  });

  const play = async () => {
    try {
      playItems([
        {
          id: record.id,
          url: record.url,
          localPath: record.filePath,
          filePath: record.filePath,
          fileName: record.fileName,
          mediaKind: record.mediaKind,
          title: record.title || record.fileName,
          creatorName: record.creatorName,
          artwork:
            record.thumbnailUrl ??
            (record.mediaKind === "image" ? record.url : null),
          service: record.service,
          creatorId: record.creatorId,
          postId: record.postId,
        },
      ]);
    } catch (error) {
      reportError(error, "Could not play download");
    }
  };

  const open = () => {
    if (!canOpen) return;
    if (record.mediaKind === "image") {
      setViewerOpen(true);
      return;
    }
    void play();
  };

  return (
    <article className="content-row rounded-lg border border-line/70 bg-card p-3.5 transition hover:border-accent/35">
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={!canOpen}
          onClick={open}
          aria-label={
            canOpen
              ? record.mediaKind === "image"
                ? `View ${record.title || record.fileName}`
                : `Play ${record.title || record.fileName}`
              : `${record.title || record.fileName} ${STATUS_LABEL[record.status].toLowerCase()}`
          }
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default"
        >
          <div className="relative shrink-0">
            <MediaThumbnail
              kind={record.mediaKind}
              thumbnailUrl={record.thumbnailUrl}
              mediaUrl={record.url}
              localPath={record.filePath}
              className="h-12 w-12"
            />
            <span
              className={cn(
                "absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-card",
                record.status === "completed"
                  ? "bg-success text-base"
                  : record.status === "failed"
                    ? "bg-danger text-white"
                    : "bg-accent text-base",
              )}
            >
              {record.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : record.status === "failed" ? (
                <AlertCircle className="h-3 w-3" />
              ) : active ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 truncate text-xs font-bold text-ink">
                {record.title || record.fileName}
              </p>
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                  record.status === "completed"
                    ? "border-success/25 bg-success/10 text-success"
                    : record.status === "failed"
                      ? "border-danger/25 bg-danger/10 text-danger"
                      : "border-accent/25 bg-accent/10 text-accent",
                )}
              >
                {STATUS_LABEL[record.status]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted">
              {record.creatorName ? `${record.creatorName} · ` : ""}
              {record.fileName} · {formatRelative(record.updatedAt)}
            </p>
            {percent !== null && active ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : null}
            {record.error ? (
              <p className="mt-1 text-[10px] text-danger">{record.error}</p>
            ) : null}
            <p className="mt-1 text-[9px] tabular-nums text-dim">
              {formatBytes(record.downloadedBytes)}
              {record.totalBytes ? ` / ${formatBytes(record.totalBytes)}` : ""}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {active ? (
            <IconButton
              label="Cancel download"
              icon={X}
              size="sm"
              onClick={() => cancel.mutate()}
            />
          ) : (
            <>
              {record.status === "failed" || record.status === "cancelled" ? (
                <IconButton
                  label="Retry download"
                  icon={RefreshCw}
                  size="sm"
                  onClick={() => retry.mutate()}
                />
              ) : null}
              <IconButton
                label="Delete file"
                icon={Trash2}
                size="sm"
                onClick={() => setConfirmDelete(true)}
              />
            </>
          )}
        </div>
      </div>

      {viewerOpen && record.mediaKind === "image" ? (
        <ImageViewer
          images={[image]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete downloaded file?"
        message={`This permanently deletes "${record.fileName}" from disk and removes its download record. This cannot be undone.`}
        confirmLabel="Delete file"
        danger
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </article>
  );
});

export function DownloadsPage() {
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItemInput[]>([]);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(savedDownloadsVisible);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    savedDownloadsVisible = visibleCount;
  }, [visibleCount]);

  const downloads = useQuery({
    queryKey: ["downloads"],
    queryFn: () => api.listDownloads(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.some((item) => item.status === "queued" || item.status === "downloading")
        ? 3_000
        : false;
    },
    staleTime: 15_000,
  });

  const clear = useMutation({
    mutationFn: () => api.clearCompletedDownloads(),
    onSuccess: (count) => {
      toast("success", "Downloads cleared", `${count} completed item${count === 1 ? "" : "s"}.`);
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
    },
    onError: (error) => reportError(error, "Could not clear downloads"),
  });

  const clearAll = useMutation({
    mutationFn: () => api.clearAllDownloads(),
    onSuccess: (count) => {
      toast(
        "success",
        "All downloads cleared",
        `${count} item${count === 1 ? "" : "s"} removed.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["downloads"] });
      void queryClient.invalidateQueries({ queryKey: ["playlist-items"] });
    },
    onError: (error) => reportError(error, "Could not clear all downloads"),
  });

  const openFolder = useMutation({
    mutationFn: () => api.openDownloadsFolder(),
    onError: (error) => reportError(error, "Could not open downloads folder"),
  });

  const items = (downloads.data ?? []).filter(
    (item) => !isCreatorBlocked(blockedCreators, item.service, item.creatorId),
  );
  const visibleItems = items.slice(0, visibleCount);
  const completedItems = items.filter((item) => item.status === "completed");
  const completed = completedItems.length;

  const addAllToPlaylist = () => {
    const entries = completedItems.map((record): PlaylistItemInput => {
      let mediaPath = record.url;
      try {
        const url = new URL(record.url);
        if (url.pathname.startsWith("/data/")) {
          mediaPath = decodeURIComponent(url.pathname)
            .replace(/^\/data\/?/, "")
            .replace(/^\/+/, "");
        }
      } catch {
        // Keep the full URL as a unique playlist key if parsing fails.
      }
      return {
        service: record.service,
        creatorId: record.creatorId,
        postId: record.postId,
        mediaPath,
        mediaUrl: record.url,
        title: record.title || record.fileName,
        creatorName: record.creatorName,
        thumbnailUrl:
          record.thumbnailUrl ??
          (record.mediaKind === "image" ? record.url : null),
        mediaKind: record.mediaKind,
      };
    });
    setPlaylistItems(entries);
    setPlaylistOpen(true);
  };

  useEffect(() => {
    if (visibleCount >= items.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) =>
            Math.min(count + DOWNLOAD_CHUNK, items.length),
          );
        }
      },
      {
        root: document.getElementById("main-scroll"),
        rootMargin: "600px 0px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, visibleCount]);

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-accent">
          <Download className="h-4 w-4" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
            Downloads
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isMobile ? (
            <Button
              variant="secondary"
              size="sm"
              loading={openFolder.isPending}
              onClick={() => openFolder.mutate()}
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open folder
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={completed === 0}
            onClick={addAllToPlaylist}
          >
            <ListPlus className="h-3.5 w-3.5" /> Add all to playlist
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={completed === 0}
            loading={clear.isPending}
            onClick={() => clear.mutate()}
          >
            Clear completed
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={items.length === 0}
            loading={clearAll.isPending}
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear all
          </Button>
        </div>
      </div>

      {downloads.isLoading ? (
        <div className="flex justify-center py-12">
          <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : downloads.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Could not load downloads"
          message={errorMessage(downloads.error)}
          action={
            <Button variant="secondary" onClick={() => void downloads.refetch()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Download}
          title="No downloads yet"
          message="Use “Download” on a post, playlist, or attachment to queue files."
          action={
            !isMobile ? (
              <Button variant="secondary" onClick={() => void openFolder.mutate()}>
                <FolderOpen className="h-4 w-4" /> Open downloads folder
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleItems.map((record) => (
            <DownloadRow key={record.id} record={record} />
          ))}
          {visibleCount < items.length ? (
            <div ref={sentinelRef} className="h-px" aria-hidden="true" />
          ) : null}
        </div>
      )}

      <PlaylistPicker
        open={playlistOpen}
        items={playlistItems}
        onClose={() => setPlaylistOpen(false)}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title="Clear all downloads?"
        message="Every download record and its local file will be deleted. This cannot be undone."
        confirmLabel="Clear all"
        danger
        onConfirm={() => clearAll.mutate()}
        onClose={() => setConfirmClearAll(false)}
      />
    </div>
  );
}
