import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, LoaderCircle, Play, Plus, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../services/api";
import { errorMessage } from "../../../lib/constants";
import { isCreatorBlocked } from "../../../lib/blockedCreators";
import { queryKeys } from "../../../shared/query/keys";
import { cn } from "../../../lib/format";
import { postGridMetrics } from "../../../lib/layout";
import { navigate } from "../../../lib/router";
import { useAppStore } from "../../../stores/app";
import { usePlayerStore } from "../../../player/store";
import {
  isPlayableMediaKind,
  queueItemFromPlaylistItem,
} from "../../../player/queue";
import {
  CreatorCard,
  CreatorCardSkeleton,
} from "../../../components/cards";
import { PlaylistDialog } from "./PlaylistDialog";
import { useDownloadActions } from "../../downloads/model/useDownloadActions";
import { SiteIcon } from "../../../components/SiteIcon";
import {
  Button,
  EmptyState,
  IconButton,
  Skeleton,
} from "../../../components/ui";
import type { Playlist } from "../../../types";

function PlaylistCard({
  playlist,
  onPlay,
  onDownload,
  busy,
}: {
  playlist: Playlist;
  onPlay: () => void;
  onDownload: () => void;
  busy?: boolean;
}) {
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  const [coverLoaded, setCoverLoaded] = useState(false);

  useEffect(() => {
    setCoverLoaded(false);
  }, [playlist.coverUrl]);

  if (cardSize === "small") {
    return (
      <article
        role="link"
        tabIndex={0}
        aria-label={`Open playlist ${playlist.name}`}
        onClick={() => navigate({ name: "playlist", playlistId: playlist.id })}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate({ name: "playlist", playlistId: playlist.id });
          }
        }}
        className="site-card group relative aspect-square h-full cursor-pointer overflow-hidden rounded-xl2 border border-line/80 bg-card"
      >
        <div className="absolute inset-0">
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt=""
              loading="lazy"
              className={cn(
                "h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]",
                coverLoaded ? "opacity-100" : "opacity-0",
              )}
              onLoad={() => setCoverLoaded(true)}
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(var(--accent)/0.18),transparent_55%)]">
              <SiteIcon name="playlists" size={36} className="opacity-35" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        </div>
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[9px] text-white/80">
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          {playlist.itemCount} item{playlist.itemCount === 1 ? "" : "s"}
        </span>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <IconButton
            label="Play playlist"
            icon={busy ? LoaderCircle : Play}
            size="sm"
            disabled={busy || playlist.itemCount === 0}
            iconClassName={busy ? "animate-spin" : undefined}
            className="bg-black/55 text-white hover:bg-black/75 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
          />
          <IconButton
            label="Download playlist"
            icon={Download}
            size="sm"
            disabled={busy || playlist.itemCount === 0}
            className="bg-black/55 text-white hover:bg-black/75 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <h3 className="truncate text-xs font-bold text-white drop-shadow">
            {playlist.name}
          </h3>
          {playlist.description ? (
            <p className="mt-0.5 line-clamp-1 text-[9px] text-white/60">
              {playlist.description}
            </p>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`Open playlist ${playlist.name}`}
      onClick={() => navigate({ name: "playlist", playlistId: playlist.id })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate({ name: "playlist", playlistId: playlist.id });
        }
      }}
      className="site-card group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl2 border border-line/80 bg-card"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-elevated">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(var(--accent)/0.18),transparent_55%)]">
            <SiteIcon name="playlists" size={40} className="opacity-35" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-[10px] text-white/80">
          <Play className="h-3 w-3" fill="currentColor" />
          {playlist.itemCount} item{playlist.itemCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="truncate text-sm font-bold text-ink">{playlist.name}</h3>
        {playlist.description ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
            {playlist.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center gap-1.5 pt-3">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={busy || playlist.itemCount === 0}
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
          >
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Play
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || playlist.itemCount === 0}
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            title="Download playlist"
            aria-label="Download playlist"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function HomePage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const { downloadPlaylist: startPlaylistDownload } = useDownloadActions();
  const playItems = usePlayerStore((state) => state.playItems);
  const cardSize = useAppStore((state) => state.settings.postCardSize);
  const playlistMetrics = postGridMetrics(cardSize);
  const playlistGridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${playlistMetrics.minColumnWidth}px, 1fr))`,
  };

  const playlists = useQuery({
    queryKey: queryKeys.playlists(),
    queryFn: () => api.listPlaylists(),
    staleTime: 20_000,
  });
  const favorites = useQuery({
    queryKey: queryKeys.favoritesCreators(),
    queryFn: () => api.listFavoriteCreators(),
    staleTime: 20_000,
  });

  const playPlaylist = async (playlist: Playlist) => {
    setBusyId(playlist.id);
    try {
      const items = await api.listPlaylistItems(playlist.id);
      if (items.length === 0) {
        toast("info", "This playlist is empty");
        return;
      }
      const blockedCreators =
        useAppStore.getState().settings.blockedCreators ?? [];
      const playable = items.filter(
        (item) =>
          isPlayableMediaKind(item.mediaKind) &&
          !isCreatorBlocked(blockedCreators, item.service, item.creatorId),
      );
      if (playable.length === 0) {
        toast(
          "info",
          "No playable media",
          "This playlist only contains images. Open it to view them.",
        );
        return;
      }
      playItems(playable.map(queueItemFromPlaylistItem), 0);
    } catch (error) {
      reportError(error, "Could not open playlist");
    } finally {
      setBusyId(null);
    }
  };

  const downloadPlaylist = async (playlist: Playlist) => {
    setBusyId(playlist.id);
    try {
      const count = await startPlaylistDownload(playlist.id);
      toast("success", "Download started", `${count} file${count === 1 ? "" : "s"} queued.`);
    } catch (error) {
      reportError(error, "Could not download playlist");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-9 pb-10">
      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-accent">
            <SiteIcon name="playlists" size={18} />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
              Your playlists
            </span>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New playlist
          </Button>
        </div>

        {playlists.isLoading ? (
          <div className="grid gap-4" style={playlistGridStyle}>
            {Array.from({ length: 4 }).map((_, index) =>
              cardSize === "small" ? (
                <Skeleton
                  key={index}
                  className="aspect-square w-full rounded-xl2"
                />
              ) : (
                <div
                  key={index}
                  className="overflow-hidden rounded-xl2 border border-line/70 bg-card"
                >
                  <Skeleton className="aspect-[16/9] w-full" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ),
            )}
          </div>
        ) : playlists.isError ? (
          <EmptyState
            icon={Star}
            title="Could not load playlists"
            message={errorMessage(playlists.error)}
            action={
              <Button variant="secondary" onClick={() => void playlists.refetch()}>
                Try again
              </Button>
            }
          />
        ) : playlists.data && playlists.data.length > 0 ? (
          <div className="grid gap-4" style={playlistGridStyle}>
            {playlists.data.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                busy={busyId === playlist.id}
                onPlay={() => void playPlaylist(playlist)}
                onDownload={() => void downloadPlaylist(playlist)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Play}
            title="No playlists yet"
            message="Create a playlist, then add audio or video from any post."
          />
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2 text-accent">
          <Star className="h-3.5 w-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
            Favorite creators
          </span>
        </div>
        {favorites.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <CreatorCardSkeleton key={index} />
            ))}
          </div>
        ) : favorites.isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Could not load favorite creators"
            message={errorMessage(favorites.error)}
            action={
              <Button variant="secondary" onClick={() => void favorites.refetch()}>
                Try again
              </Button>
            }
          />
        ) : favorites.data && favorites.data.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {favorites.data.map((creator) => (
              <CreatorCard
                key={`${creator.service}:${creator.id}`}
                creator={creator}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Star}
            title="No favorite creators yet"
            message="Use the star on a creator card or profile to add them here."
            action={
              <Button variant="secondary" onClick={() => navigate({ name: "creators" })}>
                Browse creators
              </Button>
            }
          />
        )}
      </section>

      <PlaylistDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
