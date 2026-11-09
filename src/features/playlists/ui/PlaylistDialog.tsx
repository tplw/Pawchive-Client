import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../shared/api";
import { queryKeys } from "../../../shared/query/keys";
import { useAppStore } from "../../../app/store";
import { Button, Field, Modal, TextInput } from "../../../shared/ui";

export function PlaylistDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (playlistId: number) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createPlaylist(name.trim(), description.trim()),
    onSuccess: (playlist) => {
      toast("success", "Playlist created", playlist.name);
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
      setName("");
      setDescription("");
      onClose();
      onCreated?.(playlist.id);
    },
    onError: (error) => reportError(error, "Could not create playlist"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New playlist"
      description="Group audio and video attachments into a playlist."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() => create.mutate()}
          >
            Create playlist
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="Name">
          <TextInput
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="e.g. Watch later"
          />
        </Field>
        <Field label="Description" hint="Optional. A short note about this playlist.">
          <TextInput
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            placeholder="Optional description"
          />
        </Field>
      </form>
    </Modal>
  );
}
