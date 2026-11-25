import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { api } from "../../../shared/api";
import { serviceLabel } from "../../../shared/lib/constants";
import { cn, formatBytes, formatRelative } from "../../../shared/lib/format";
import { queryKeys } from "../../../shared/query/keys";
import { useAppStore } from "../../../app/store";
import { usePlayerStore } from "../../player/model/store";
import { isPlayableMediaKind } from "../../player/model/queue";
import {
  attachmentFromDownload,
  queueItemFromDownload,
} from "../../media/model/attachments";
import { ImageViewer } from "../../media/ui/ImageViewer";
import { MediaThumbnail } from "../../media/ui/MediaThumbnail";
import { ConfirmDialog, IconButton } from "../../../shared/ui";
import type { Attachment, DownloadRecord } from "../../../shared/types";

const STATUS_LABEL: Record<DownloadRecord["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<DownloadRecord["status"], string> = {
  queued: "border-accent/25 bg-accent/10 text-accent",
  downloading: "border-accent/25 bg-accent/10 text-accent",
  completed: "border-success/25 bg-success/10 text-success",
  failed: "border-danger/25 bg-danger/10 text-danger",
  cancelled: "border-favorite/25 bg-favorite/10 text-favorite",
};

const KIND_LABEL: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  other: "File",
};

export const DownloadRow = memo(function DownloadRow({
  record,
}: {
  record: DownloadRecord;
}) {
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const enqueue = usePlayerStore((state) => state.enqueue);
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
    () =>
      attachmentFromDownload(record, localUrl),
    [localUrl, record],
  );

  const cancel = useMutation({
    mutationFn: () => api.cancelDownload(record.id),
    onSuccess: () => {
      toast("info", "Download cancelled", record.fileName);
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
    },
    onError: (error) => reportError(error, "Could not cancel download"),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDownload(record.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlistItems(),
      });
    },
    onError: (error) => reportError(error, "Could not delete download"),
  });

  const retry = useMutation({
    mutationFn: () => api.retryDownload(record.id),
    onSuccess: () => {
      toast("info", "Download requeued", record.fileName);
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
    },
    onError: (error) => reportError(error, "Could not retry download"),
  });

  const play = async () => {
    try {
      // Keep everything already queued; a single download should play now
      // without wiping a playlist or queue built from other posts.
      enqueue([queueItemFromDownload(record)], true);
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
    <article className="content-row group rounded-xl2 border border-line/65 bg-card/60 p-3 transition hover:border-accent/30 hover:bg-card">
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
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default"
        >
          <div className="relative shrink-0">
            <MediaThumbnail
              kind={record.mediaKind}
              thumbnailUrl={record.thumbnailUrl}
              mediaUrl={record.url}
              localPath={record.filePath}
              className="h-14 w-14 rounded-lg"
            />
            <span
              className={cn(
                "absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-card",
                record.status === "completed"
                  ? "bg-success text-base"
                  : record.status === "failed"
                    ? "bg-danger text-white"
                    : record.status === "cancelled"
                      ? "bg-favorite text-base"
                      : "bg-accent text-base",
              )}
            >
              {record.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : record.status === "failed" ? (
                <AlertCircle className="h-3 w-3" />
              ) : record.status === "cancelled" ? (
                <X className="h-3 w-3" />
              ) : record.status === "downloading" ? (
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
                  STATUS_TONE[record.status],
                )}
              >
                {STATUS_LABEL[record.status]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted">
              {record.creatorName ? `${record.creatorName} · ` : ""}
              {serviceLabel(record.service)} · {record.fileName}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-dim">
              <span className="uppercase tracking-[0.12em]">
                {KIND_LABEL[record.mediaKind] ?? record.mediaKind}
              </span>
              <span>·</span>
              <span>{formatRelative(record.updatedAt)}</span>
            </p>
            {active ? (
              <div className="mt-2">
                <div
                  role="progressbar"
                  aria-label="Download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent === null ? 0 : Math.round(percent)}
                  className="h-1.5 overflow-hidden rounded-full bg-white/10"
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-accent transition-[width]",
                      record.status === "queued" && "w-[12%] animate-pulse",
                    )}
                    style={
                      percent === null ? undefined : { width: `${percent}%` }
                    }
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9px] tabular-nums text-dim">
                  <span>
                    {formatBytes(record.downloadedBytes)}
                    {record.totalBytes
                      ? ` / ${formatBytes(record.totalBytes)}`
                      : ""}
                  </span>
                  <span>
                    {percent === null ? "Queued" : `${Math.round(percent)}%`}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[9px] tabular-nums text-dim">
                {formatBytes(record.downloadedBytes)}
                {record.totalBytes
                  ? ` / ${formatBytes(record.totalBytes)}`
                  : ""}
              </p>
            )}
            {record.error ? (
              <p className="mt-1 text-[10px] leading-relaxed text-danger">
                {record.error}
              </p>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {canOpen ? (
            <IconButton
              label={record.mediaKind === "image" ? "View image" : "Play"}
              icon={record.mediaKind === "image" ? ImageIcon : Play}
              size="sm"
              onClick={open}
            />
          ) : null}
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

