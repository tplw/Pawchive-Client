import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  Download,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { queryKeys } from "../../../shared/query/keys";
import { navigate, switchTab } from "../../../shared/lib/router";
import { useAppStore } from "../../../app/store";
import { usePlayerStore } from "../../player/model/store";
import {
  isPlayableMediaKind,
  queueItemFromPlaylistItem,
} from "../../player/model/queue";
import { attachmentFromPlaylistItem } from "../../media/model/attachments";
import { useDownloadActions } from "../../downloads/model/useDownloadActions";
import { ImageViewer } from "../../media/ui/ImageViewer";
import { MediaThumbnail } from "../../media/ui/MediaThumbnail";
import { SiteIcon } from "../../../shared/SiteIcon";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SectionHeader,
  Spinner,
} from "../../../shared/ui";
import type { Attachment, PlaylistItem } from "../../../shared/types";

function playlistFileName(item: PlaylistItem): string {
  return item.mediaPath.split("/").filter(Boolean).pop() || item.title;
}

export function PlaylistPage({ playlistId }: { playlistId: number }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [localImageUrls, setLocalImageUrls] = useState<Record<number, string>>(
    {},
  );
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const { startDownload, downloadPlaylist: startPlaylistDownload } =
    useDownloadActions();
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const playItems = usePlayerStore((state) => state.playItems);
  const enqueue = usePlayerStore((state) => state.enqueue);

  const playlist = useQuery({
    queryKey: queryKeys.playlist(playlistId),
    queryFn: () => api.getPlaylist(playlistId),
    staleTime: 20_000,
  });
  const items = useQuery({
    queryKey: queryKeys.playlistItems(playlistId),
    queryFn: () => api.listPlaylistItems(playlistId),
    // The localPath field is only returned for files that still exist on
    // disk. Re-check it whenever the playlist is reopened or focused so a
    // deleted download cannot keep showing the offline check mark.
    staleTime: 0,
  });

  const allItems = useMemo(
    () =>
      (items.data ?? []).filter(
        (item) =>
          !isCreatorBlocked(blockedCreators, item.service, item.creatorId),
      ),
    [blockedCreators, items.data],
  );
  const playableItems = useMemo(
    () => allItems.filter((item) => isPlayableMediaKind(item.mediaKind)),
    [allItems],
  );
  const imageItems = useMemo(
    () => allItems.filter((item) => item.mediaKind === "image"),
    [allItems],
  );
  const queue = useMemo(
    () => playableItems.map(queueItemFromPlaylistItem),
    [playableItems],
  );

  useEffect(() => {
    let cancelled = false;
    for (const item of imageItems) {
      if (!item.localPath) continue;
      void api
        .localMediaUrl(item.localPath)
        .then((url) => {
          if (cancelled) return;
          setLocalImageUrls((current) =>
            current[item.id] === url
              ? current
              : { ...current, [item.id]: url },
          );
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [imageItems]);

  const images = useMemo<Attachment[]>(
    () =>
      imageItems.map((item) =>
        attachmentFromPlaylistItem(
          item,
          localImageUrls[item.id] ?? item.mediaUrl,
        ),
      ),
    [imageItems, localImageUrls],
  );

  useEffect(() => {
    if (!items.data) return;
    // Thumbnail enrichment runs in the backend while items load. Refresh the
    // playlist card and header so a newly discovered cover appears immediately.
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlist(playlistId) });
  }, [items.data, items.dataUpdatedAt, playlistId, queryClient]);

  const removeItem = useMutation({
    mutationFn: (id: number) => api.removePlaylistItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlistItems(playlistId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlist(playlistId) });
    },
    onError: (error) => reportError(error, "Could not remove item"),
  });

  const reorder = useMutation({
    mutationFn: (itemIds: number[]) =>
      api.reorderPlaylistItems(playlistId, itemIds),
    onMutate: async (itemIds) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.playlistItems(playlistId),
      });
      const previous = queryClient.getQueryData<PlaylistItem[]>(
        queryKeys.playlistItems(playlistId),
      );
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        queryClient.setQueryData(
          queryKeys.playlistItems(playlistId),
          itemIds
            .map((id) => byId.get(id))
            .filter((item): item is PlaylistItem => Boolean(item)),
        );
      }
      return { previous };
    },
    onError: (error, _itemIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.playlistItems(playlistId),
          context.previous,
        );
      }
      reportError(error, "Could not reorder playlist");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlistItems(playlistId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlist(playlistId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
    },
  });

  const deletePlaylist = useMutation({
    mutationFn: () => api.deletePlaylist(playlistId),
    onSuccess: () => {
      toast("success", "Playlist deleted");
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      navigate({ name: "home" });
    },
    onError: (error) => reportError(error, "Could not delete playlist"),
  });

  const download = useMutation({
    mutationFn: () => startPlaylistDownload(playlistId),
    onSuccess: (count) => {
      toast("success", "Download started", `${count} file${count === 1 ? "" : "s"} queued.`);
    },
    onError: (error) => reportError(error, "Could not download playlist"),
  });

  const openItem = (item: PlaylistItem) => {
    if (item.mediaKind === "image") {
      const index = imageItems.findIndex((entry) => entry.id === item.id);
      if (index >= 0) setViewerIndex(index);
      return;
    }
    const index = playableItems.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      playItems(queue, index);
      return;
    }
    // Documents cannot be rendered by the player. Open their original post
    // instead, or start a download when the item has no post route.
    if (item.postId) {
      navigate({
        name: "post",
        service: item.service,
        creatorId: item.creatorId,
        postId: item.postId,
      });
      return;
    }
    downloadItem(item);
  };

  const addToQueue = (item: PlaylistItem) => {
    const index = playableItems.findIndex((entry) => entry.id === item.id);
    const queued = queue[index];
    if (queued) enqueue([queued]);
  };

  const moveItem = (item: PlaylistItem, direction: -1 | 1) => {
    const full = items.data;
    if (!full || reorder.isPending) return;
    const currentIndex = allItems.findIndex((entry) => entry.id === item.id);
    const targetIndex = currentIndex + direction;
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= allItems.length
    ) {
      return;
    }
    const reorderedVisible = [...allItems];
    [reorderedVisible[currentIndex], reorderedVisible[targetIndex]] = [
      reorderedVisible[targetIndex],
      reorderedVisible[currentIndex],
    ];
    const visibleIds = new Set(allItems.map((entry) => entry.id));
    let cursor = 0;
    // Keep blocked/hidden items in their existing slots while reordering the
    // items the user can actually see.
    const reorderedFull = full.map((entry) =>
      visibleIds.has(entry.id) ? reorderedVisible[cursor++] : entry,
    );
    reorder.mutate(reorderedFull.map((entry) => entry.id));
  };

  const downloadItem = (item: PlaylistItem) => {
    void startDownload({
        url: item.mediaUrl,
        fileName: playlistFileName(item),
        title: item.title,
        creatorName: item.creatorName,
        service: item.service,
        creatorId: item.creatorId,
        postId: item.postId,
        playlistId,
        thumbnailUrl:
          item.thumbnailUrl ??
          (item.mediaKind === "image" ? item.mediaUrl : null),
        mediaKind: item.mediaKind,
      })
      .then(() => {
        toast("success", "Download started", playlistFileName(item));
      })
      .catch((error) => reportError(error, "Could not download item"));
  };

  if (playlist.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (playlist.isError || !playlist.data) {
    return (
      <EmptyState
        icon={ListMusic}
        title="Could not open this playlist"
        message={errorMessage(playlist.error)}
        action={
          <Button variant="secondary" onClick={() => navigate({ name: "home" })}>
            Back to playlists
          </Button>
        }
      />
    );
  }

  const detail = playlist.data;
  const coverUrl =
    detail.coverUrl ??
    imageItems[0]?.thumbnailUrl ??
    imageItems[0]?.mediaUrl ??
    null;

  return (
    <div className="pb-10">
      <button
        type="button"
        onClick={() => navigate({ name: "home" })}
        className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to playlists
      </button>

      <section className="overflow-hidden rounded-xl2 border border-line/80 bg-card">
        <div className="relative h-40 overflow-hidden bg-elevated sm:h-52">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(var(--accent)/0.2),transparent_55%)]">
              <SiteIcon name="playlists" size={56} className="opacity-35" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        </div>
        <div className="relative -mt-12 px-5 pb-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                Playlist
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
                {detail.name}
              </h1>
              <p className="mt-1 text-xs text-muted">
                {detail.itemCount} item{detail.itemCount === 1 ? "" : "s"}
                {detail.description ? ` · ${detail.description}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={queue.length === 0}
                onClick={() => playItems(queue, 0)}
              >
                <Play className="h-4 w-4" fill="currentColor" /> Play all
              </Button>
              <Button
                variant="secondary"
                loading={download.isPending}
                disabled={allItems.length === 0}
                onClick={() => download.mutate()}
              >
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button
                variant={editing ? "primary" : "secondary"}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                {editing ? "Done" : "Edit"}
              </Button>
              <IconButton
                label="Delete playlist"
                icon={Trash2}
                onClick={() => setConfirmDelete(true)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <SectionHeader
          eyebrow="Items"
          title="Playlist items"
          description={
            editing
              ? "Use the arrows to reorder items and the remove button to take media out of the playlist."
              : "Tap an item to play audio or video, or open an image full-screen."
          }
        />
        {items.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.isError ? (
          <EmptyState
            icon={ListMusic}
            title="Could not load playlist items"
            message={errorMessage(items.error)}
            action={
              <Button variant="secondary" onClick={() => void items.refetch()}>
                Try again
              </Button>
            }
          />
        ) : allItems.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="This playlist is empty"
            message="Open a post and use “Add to playlist” on an attachment."
            action={
              <Button variant="secondary" onClick={() => switchTab("discover")}>
                Browse posts
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {allItems.map((item, index) => {
              const playable = isPlayableMediaKind(item.mediaKind);
              return (
                <article
                  key={item.id}
                  className="content-row flex items-center gap-2 rounded-lg border border-line/70 bg-card px-2 py-2 transition hover:border-accent/35"
                >
                  <button
                    type="button"
                    aria-label={
                      item.mediaKind === "image"
                        ? `View ${item.title || playlistFileName(item)}`
                        : playable
                          ? `Play ${item.title || playlistFileName(item)}`
                          : `Open post for ${item.title || playlistFileName(item)}`
                    }
                    onClick={() => openItem(item)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  >
                    <span className="relative inline-flex shrink-0">
                      <MediaThumbnail
                        kind={item.mediaKind}
                        thumbnailUrl={item.thumbnailUrl}
                        mediaUrl={item.mediaUrl}
                        localPath={item.localPath}
                        className="h-12 w-16"
                      />
                      {item.localPath ? (
                        <span
                          title="Downloaded"
                          aria-label="Downloaded"
                          className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-card bg-success text-base"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-ink">
                        {item.title || playlistFileName(item)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                        <span className="truncate">
                          {item.creatorName || "Unknown creator"} · {item.mediaKind}
                        </span>
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {editing ? (
                      <>
                        <IconButton
                          label="Move up"
                          icon={ArrowUp}
                          size="sm"
                          disabled={reorder.isPending || index === 0}
                          onClick={() => moveItem(item, -1)}
                        />
                        <IconButton
                          label="Move down"
                          icon={ArrowDown}
                          size="sm"
                          disabled={
                            reorder.isPending || index === allItems.length - 1
                          }
                          onClick={() => moveItem(item, 1)}
                        />
                      </>
                    ) : (
                      <>
                        {playable ? (
                          <IconButton
                            label="Add to queue"
                            icon={ListMusic}
                            size="sm"
                            onClick={() => addToQueue(item)}
                          />
                        ) : null}
                        <IconButton
                          label="Download"
                          icon={Download}
                          size="sm"
                          onClick={() => downloadItem(item)}
                        />
                      </>
                    )}
                    <IconButton
                      label="Remove from playlist"
                      icon={X}
                      size="sm"
                      disabled={removeItem.isPending}
                      onClick={() => removeItem.mutate(item.id)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {viewerIndex !== null && images[viewerIndex] ? (
        <ImageViewer
          images={images}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete playlist?"
        message={`“${detail.name}” and its item list will be removed. The media files are not deleted.`}
        confirmLabel="Delete playlist"
        danger
        onConfirm={() => deletePlaylist.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
