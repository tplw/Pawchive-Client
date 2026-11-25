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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-accent">
            <Download className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
              Offline library
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Downloads
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
            Queue posts, playlists or a whole creator's matching media for
            offline use.
          </p>
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
        </div>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl2 border border-accent/20 bg-[radial-gradient(circle_at_8%_0%,rgb(var(--accent)/0.12),transparent_45%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">
                Download a whole creator
              </p>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                Pick a creator, filter by date, media type or blacklist words,
                preview the matches, then queue them all at once.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            className="shrink-0 self-start sm:self-center"
            onClick={() => setCreatorDownloadOpen(true)}
          >
            <Download className="h-4 w-4" /> Choose creator
          </Button>
        </div>
      </section>

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
        <div className="mt-5">
          <EmptyState
            icon={Download}
            title="No downloads yet"
            message="Download a post, a playlist, or a whole creator's matching media and it will appear here."
            action={
              <Button
                variant="primary"
                onClick={() => setCreatorDownloadOpen(true)}
              >
                <Users className="h-4 w-4" /> Download from creator
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard
              icon={Download}
              label="Active"
              value={activeItems.length}
              detail={`${queuedItems.length} queued`}
              tone="accent"
            />
            <StatCard
              icon={CheckCircle2}
              label="Completed"
              value={completedItems.length}
              detail={formatBytes(completedBytes)}
              tone="success"
            />
            <StatCard
              icon={AlertCircle}
              label="Failed"
              value={failedItems.length}
              detail={failedItems.length > 0 ? "Needs attention" : "All clear"}
              tone={failedItems.length > 0 ? "danger" : "muted"}
            />
            <StatCard
              icon={HardDrive}
              label="Library"
              value={allItems.length}
              detail={`${formatBytes(completedBytes)} saved`}
              tone="muted"
            />
          </div>

          <section className="mt-4 rounded-xl2 border border-line/70 bg-card/40 p-3">
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

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Download;
  label: string;
  value: string | number;
  detail: string;
  tone: "accent" | "success" | "danger" | "muted";
}) {
  const tones = {
    accent: "border-accent/25 bg-accent/[0.06] text-accent",
    success: "border-success/20 bg-success/[0.05] text-success",
    danger: "border-danger/20 bg-danger/[0.05] text-danger",
    muted: "border-line/70 bg-card/50 text-muted",
  };
  return (
    <div className={cn("rounded-xl2 border p-3", tones[tone])}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[9px] font-bold uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-muted">{detail}</p>
    </div>
  );
}
