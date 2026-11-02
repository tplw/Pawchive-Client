import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListMusic, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import type { PlaylistItemInput } from "../types";
import { cn } from "../lib/format";
import { Button, EmptyState, Modal, Spinner, TextInput } from "./ui";
import { SiteIcon } from "./SiteIcon";

export function PlaylistPicker({
  open,
  item = null,
  items,
  onClose,
}: {
  open: boolean;
  item?: PlaylistItemInput | null;
  items?: PlaylistItemInput[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const pending = useMemo(
    () => items ?? (item ? [item] : []),
    [items, item],
  );

  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.listPlaylists(),
    enabled: open,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (!open) return;
    setSelected(playlists.data?.[0]?.id ?? null);
    setNewName("");
  }, [open, playlists.data]);

  const add = useMutation({
    mutationFn: async () => {
      if (pending.length === 0) throw new Error("Nothing to add");
      let playlistId = selected;
      let playlistName = playlists.data?.find(
        (entry) => entry.id === selected,
      )?.name;
      if (newName.trim()) {
        const playlist = await api.createPlaylist(newName.trim());
        playlistId = playlist.id;
        playlistName = playlist.name;
      }
      if (!playlistId) throw new Error("Choose a playlist first");
      for (const entry of pending) {
        await api.addPlaylistItem(playlistId, entry);
      }
      return {
        name: playlistName ?? "playlist",
        count: pending.length,
      };
    },
    onSuccess: ({ name, count }) => {
      toast(
        "success",
        count === 1 ? "Added to playlist" : `Added ${count} items`,
        name,
      );
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
      void queryClient.invalidateQueries({ queryKey: ["playlist-items"] });
      onClose();
    },
    onError: (error) => reportError(error, "Could not add to playlist"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to playlist"
      description="Choose a playlist, or create one now."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={pending.length === 0 || (!newName.trim() && !selected)}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </>
      }
    >
      {playlists.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : playlists.isError ? (
        <EmptyState
          icon={ListMusic}
          title="Could not load playlists"
          message="Try again in a moment."
        />
      ) : playlists.data && playlists.data.length > 0 ? (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {playlists.data.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => {
                setSelected(playlist.id);
                setNewName("");
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                selected === playlist.id && !newName
                  ? "border-accent/50 bg-accent/10"
                  : "border-line/70 bg-base/40 hover:border-accent/30",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded bg-elevated">
                {playlist.coverUrl ? (
                  <img src={playlist.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <SiteIcon name="playlists" size={17} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-ink">
                  {playlist.name}
                </span>
                <span className="text-[10px] text-muted">
                  {playlist.itemCount} item{playlist.itemCount === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
          No playlists yet. Name one below to get started.
        </p>
      )}

      <div className="mt-4 border-t border-line/60 pt-4">
        <label className="mb-1.5 block text-xs font-medium text-ink" htmlFor="new-playlist-name">
          Or create a new playlist
        </label>
        <TextInput
          id="new-playlist-name"
          value={newName}
          onChange={(event) => {
            setNewName(event.target.value);
            if (event.target.value) setSelected(null);
          }}
          maxLength={80}
          placeholder="Playlist name"
        />
      </div>
    </Modal>
  );
}
