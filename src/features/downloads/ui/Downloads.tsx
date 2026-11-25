import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  ListPlus,
  LoaderCircle,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { cn, formatBytes } from "../../../shared/lib/format";
import { DownloadRow } from "./DownloadRow";
import { CreatorDownloadDialog } from "./CreatorDownloadDialog";
import { DownloadSchedules } from "./DownloadSchedules";
import { queryKeys } from "../../../shared/query/keys";
import { useAppStore } from "../../../app/store";
import { isMobile } from "../../../shared/lib/platform";
import { PlaylistPicker } from "../../playlists/ui/PlaylistPicker";
import { Button, ConfirmDialog, EmptyState } from "../../../shared/ui";
import type { PlaylistItemInput } from "../../../shared/types";

const DOWNLOAD_CHUNK = 80;
let savedDownloadsVisible = DOWNLOAD_CHUNK;

type StatusFilter = "all" | "active" | "completed" | "failed";
type MediaFilter = "all" | "image" | "video" | "audio" | "file";
type DownloadSort = "newest" | "oldest" | "largest" | "name";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
};

export function DownloadsPage() {
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const [creatorDownloadOpen, setCreatorDownloadOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItemInput[]>([]);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [sort, setSort] = useState<DownloadSort>("newest");
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
      return data?.some(
        (item) => item.status === "queued" || item.status === "downloading",
      )
        ? 3_000
        : false;
    },
    staleTime: 15_000,
  });

  const clear = useMutation({
    mutationFn: () => api.clearCompletedDownloads(),
    onSuccess: (count) => {
      toast(
        "success",
        "Downloads cleared",
        `${count} completed item${count === 1 ? "" : "s"}.`,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlistItems() });
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

  const allItems = useMemo(
    () =>
      (downloads.data ?? []).filter(
        (item) =>
          !isCreatorBlocked(blockedCreators, item.service, item.creatorId),
      ),
    [blockedCreators, downloads.data],
  );
  const activeItems = useMemo(
    () =>
      allItems.filter(
        (item) => item.status === "queued" || item.status === "downloading",
      ),
    [allItems],
  );
  const completedItems = useMemo(
    () => allItems.filter((item) => item.status === "completed"),
    [allItems],
  );
  const failedItems = useMemo(
    () =>
      allItems.filter(
        (item) => item.status === "failed" || item.status === "cancelled",
      ),
    [allItems],
  );
  const queuedItems = useMemo(
    () => allItems.filter((item) => item.status === "queued"),
    [allItems],
  );
  const completedBytes = useMemo(
    () =>
      completedItems.reduce(
        (total, item) => total + (item.totalBytes ?? item.downloadedBytes),
        0,
      ),
    [completedItems],
  );
  const searchText = search.trim().toLowerCase();
  const hasFilters =
    searchText.length > 0 || statusFilter !== "all" || mediaFilter !== "all";

  const filteredItems = useMemo(() => {
    const matches = allItems.filter((item) => {
      if (searchText) {
        const haystack = `${item.title} ${item.fileName} ${item.creatorName}`.toLowerCase();
        if (!haystack.includes(searchText)) return false;
      }
      if (statusFilter === "active") {
        if (item.status !== "queued" && item.status !== "downloading") {
          return false;
        }
      } else if (statusFilter === "completed") {
        if (item.status !== "completed") return false;
      } else if (statusFilter === "failed") {
        if (item.status !== "failed" && item.status !== "cancelled") {
          return false;
        }
      }
      if (mediaFilter === "image" && item.mediaKind !== "image") return false;
      if (mediaFilter === "video" && item.mediaKind !== "video") return false;
      if (mediaFilter === "audio" && item.mediaKind !== "audio") return false;
      if (
        mediaFilter === "file" &&
        item.mediaKind !== "document" &&
        item.mediaKind !== "other"
      ) {
        return false;
      }
      return true;
    });
    return [...matches].sort((left, right) => {
      if (sort === "oldest") return left.createdAt - right.createdAt;
      if (sort === "largest") {
        return (
          (right.totalBytes ?? right.downloadedBytes) -
          (left.totalBytes ?? left.downloadedBytes)
        );
      }
      if (sort === "name") {
        return (left.title || left.fileName).localeCompare(
          right.title || right.fileName,
        );
      }
      return right.createdAt - left.createdAt;
    });
  }, [allItems, mediaFilter, searchText, sort, statusFilter]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(DOWNLOAD_CHUNK);
  }, [mediaFilter, search, sort, statusFilter]);

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
    if (visibleCount >= filteredItems.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) =>
            Math.min(count + DOWNLOAD_CHUNK, filteredItems.length),
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
  }, [filteredItems.length, visibleCount]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setMediaFilter("all");
  };

  return (
    <div className="mx-auto max-w-5xl pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {allItems.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-line/60 bg-card/30 px-3 py-2 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Download className="h-3 w-3 text-accent" />
              <strong className="font-semibold text-ink">
                {activeItems.length}
              </strong>
              active
              {queuedItems.length > 0 ? ` · ${queuedItems.length} queued` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-success/80" />
              <strong className="font-semibold text-ink">
                {completedItems.length}
              </strong>
              completed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3 text-muted" />
              <strong className="font-semibold text-ink">
                {failedItems.length}
              </strong>
              failed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="h-3 w-3 text-muted" />
              <strong className="font-semibold text-ink">
                {formatBytes(completedBytes)}
              </strong>
              saved
            </span>
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreatorDownloadOpen(true)}
          >
            <Users className="h-3.5 w-3.5" /> Choose creator
          </Button>
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
        </div>
      </div>

      <DownloadSchedules />

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
      ) : allItems.length === 0 ? (
        <EmptyState
          icon={Download}
          title="No downloads yet"
          message="Choose a creator or download a post or playlist to build your offline library."
        />
      ) : (
        <>
          <section className="rounded-xl2 border border-line/70 bg-card/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search downloads…"
                  spellCheck={false}
                  className="h-9 w-full rounded-lg border border-line bg-base pl-9 pr-3 text-xs text-ink outline-none transition placeholder:text-dim focus:border-accent/70"
                />
              </div>
              <select
                value={mediaFilter}
                onChange={(event) =>
                  setMediaFilter(event.target.value as MediaFilter)
                }
                aria-label="Filter by media type"
                className="h-9 rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
              >
                <option value="all">All media</option>
                <option value="image">Images</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="file">Files</option>
              </select>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as DownloadSort)
                }
                aria-label="Sort downloads"
                className="h-9 rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest first</option>
                <option value="name">Name</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", allItems.length],
                    ["active", activeItems.length],
                    ["completed", completedItems.length],
                    ["failed", failedItems.length],
                  ] as Array<[StatusFilter, number]>
                ).map(([value, count]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    aria-pressed={statusFilter === value}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition",
                      statusFilter === value
                        ? "bg-accent/12 text-accent"
                        : "text-muted hover:bg-elevated hover:text-ink",
                    )}
                  >
                    {STATUS_LABELS[value]} {count}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={completedItems.length === 0}
                  onClick={addAllToPlaylist}
                >
                  <ListPlus className="h-3.5 w-3.5" /> Add completed
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={completedItems.length === 0}
                  loading={clear.isPending}
                  onClick={() => clear.mutate()}
                >
                  Clear completed
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={allItems.length === 0}
                  loading={clearAll.isPending}
                  onClick={() => setConfirmClearAll(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear all
                </Button>
              </div>
            </div>
          </section>

          <div className="mb-2 mt-5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/80">
              {filteredItems.length} download
              {filteredItems.length === 1 ? "" : "s"}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[10px] text-muted transition hover:text-ink"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No downloads match"
              message="Try a different search, media type or status filter."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {visibleItems.map((record) => (
                <DownloadRow key={record.id} record={record} />
              ))}
              {visibleCount < filteredItems.length ? (
                <div ref={sentinelRef} className="h-px" aria-hidden="true" />
              ) : null}
            </div>
          )}
        </>
      )}

      <CreatorDownloadDialog
        open={creatorDownloadOpen}
        onClose={() => setCreatorDownloadOpen(false)}
      />

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
