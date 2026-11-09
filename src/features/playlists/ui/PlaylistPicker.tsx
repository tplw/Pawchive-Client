import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListMusic, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../shared/api";
import { queryKeys } from "../../../shared/query/keys";
import { useAppStore } from "../../../app/store";
import type { PlaylistItemInput } from "../../../shared/types";
import { cn } from "../../../shared/lib/format";
import { Button, EmptyState, Modal, Spinner, TextInput } from "../../../shared/ui";
import { SiteIcon } from "../../../shared/SiteIcon";

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
  // Track progress within the current add operation so a retry after a
  // partial failure does not insert the already-added items again.
  const addedCount = useRef(0);
  const createdPlaylist = useRef<{ id: number; name: string } | null>(null);
  const opened = useRef(false);
  const pending = useMemo(
    () => items ?? (item ? [item] : []),
    [items, item],
  );
  const resetProgress = useCallback(() => {
    addedCount.current = 0;
    createdPlaylist.current = null;
  }, []);

  const playlists = useQuery({
    queryKey: queryKeys.playlists(),
    queryFn: () => api.listPlaylists(),
    enabled: open,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setSelected(playlists.data?.[0]?.id ?? null);
    setNewName("");
    resetProgress();
  }, [open, playlists.data, resetProgress]);

  // The playlist list often arrives after the modal opens. Pick the first
  // entry once it exists without discarding a name the user already typed.
  useEffect(() => {
    if (!open || selected !== null || newName.trim()) return;
    const first = playlists.data?.[0]?.id;
    if (first !== undefined) setSelected(first);
  }, [open, selected, newName, playlists.data]);

  useEffect(() => {
    resetProgress();
  }, [pending, resetProgress]);

  const add = useMutation({
    mutationFn: async () => {
      if (pending.length === 0) throw new Error("Nothing to add");
      let playlistId = selected;
      let playlistName = playlists.data?.find(
        (entry) => entry.id === selected,
      )?.name;
      const trimmedName = newName.trim();
      if (trimmedName) {
        if (createdPlaylist.current?.name === trimmedName) {
          playlistId = createdPlaylist.current.id;
          playlistName = createdPlaylist.current.name;
        } else {
          const playlist = await api.createPlaylist(trimmedName);
          createdPlaylist.current = { id: playlist.id, name: playlist.name };
          playlistId = playlist.id;
          playlistName = playlist.name;
        }
      }
      if (!playlistId) throw new Error("Choose a playlist first");
      for (let index = addedCount.current; index < pending.length; index += 1) {
        await api.addPlaylistItem(playlistId, pending[index]);
        addedCount.current = index + 1;
      }
      return {
        name: playlistName ?? "playlist",
        count: pending.length,
      };
    },
    onSuccess: ({ name, count }) => {
      resetProgress();
      toast(
        "success",
        count === 1 ? "Added to playlist" : `Added ${count} items`,
        name,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlistItems() });
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
                resetProgress();
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
            const value = event.target.value;
            setNewName(value);
            if (value) {
              setSelected(null);
              // Switching the destination to a new playlist invalidates the
              // partial progress from a previous attempt. Re-typing the same
              // name keeps it so a retry can resume where it failed.
              if (createdPlaylist.current?.name !== value.trim()) {
                resetProgress();
              }
            }
          }}
          maxLength={80}
          placeholder="Playlist name"
        />
      </div>
    </Modal>
  );
}
