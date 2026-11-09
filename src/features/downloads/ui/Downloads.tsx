import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Download,
  FolderOpen,
  ListPlus,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../services/api";
import { errorMessage } from "../../../lib/constants";
import { isCreatorBlocked } from "../../../lib/blockedCreators";
import { DownloadRow } from "./DownloadRow";
import { queryKeys } from "../../../shared/query/keys";
import { useAppStore } from "../../../stores/app";
import { isMobile } from "../../../lib/platform";
import { PlaylistPicker } from "../../playlists/ui/PlaylistPicker";
import { Button, ConfirmDialog, EmptyState } from "../../../components/ui";
import type { PlaylistItemInput } from "../../../types";

const DOWNLOAD_CHUNK = 80;
let savedDownloadsVisible = DOWNLOAD_CHUNK;

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
    queryKey: queryKeys.downloads(),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlistItems() });
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
