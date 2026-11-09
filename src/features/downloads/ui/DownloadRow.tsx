import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { api } from "../../../shared/api";
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

export const DownloadRow = memo(function DownloadRow({
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
    () =>
      attachmentFromDownload(
        record,
        localUrl ?? record.thumbnailUrl ?? record.url,
      ),
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
      playItems([queueItemFromDownload(record)]);
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

