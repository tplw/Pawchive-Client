import {
  Download,
  ExternalLink,
  FileText,
  Film,
  Headphones,
  Image as ImageIcon,
  ListMusic,
  ListPlus,
} from "lucide-react";
import type { Attachment, MediaKind } from "../../../shared/types";
import { cn } from "../../../shared/lib/format";
import { IconButton, SectionHeader } from "../../../shared/ui";
import { AttachmentMeta } from "./AttachmentMeta";

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Headphones,
  document: FileText,
  other: FileText,
};

export function PostAttachments({
  count,
  images,
  playable,
  documents,
  disabled,
  onViewImage,
  onPlay,
  onQueue,
  onAddToPlaylist,
  onDownload,
  onOpenFile,
}: {
  count: number;
  images: Attachment[];
  playable: Attachment[];
  documents: Attachment[];
  disabled: boolean;
  onViewImage: (index: number) => void;
  onPlay: (attachment: Attachment) => void;
  onQueue: (attachment: Attachment) => void;
  onAddToPlaylist: (attachment: Attachment) => void;
  onDownload: (attachment: Attachment) => void;
  onOpenFile: (attachment: Attachment) => void;
}) {
  if (count === 0) return null;
  return (
    <section
      className={cn(
        "mt-7",
        disabled && "pointer-events-none select-none opacity-40",
      )}
    >
      <SectionHeader
        eyebrow={`${count} attachment${count === 1 ? "" : "s"}`}
      />

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((attachment) => (
            <div
              key={attachment.path}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-line/70 bg-elevated/60"
            >
              <button
                type="button"
                onClick={() =>
                  onViewImage(
                    images.findIndex((entry) => entry.path === attachment.path),
                  )
                }
                className="block h-full w-full text-left"
              >
                {attachment.thumbnailUrl ? (
                  <img
                    src={attachment.thumbnailUrl}
                    alt={attachment.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    onError={(event) => {
                      const image = event.currentTarget;
                      if (image.dataset.fallback === "1") return;
                      image.dataset.fallback = "1";
                      image.src = attachment.url;
                    }}
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center">
                    <ImageIcon className="h-7 w-7 text-accent/45" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
                  <span className="block truncate text-[10px] text-white/80">
                    {attachment.name}
                  </span>
                  <AttachmentMeta
                    attachment={attachment}
                    className="text-white/45"
                  />
                </span>
              </button>
              <div className="touch-visible absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <IconButton
                  label={`Add ${attachment.name} to playlist`}
                  icon={ListPlus}
                  size="sm"
                  className="bg-black/60 text-white hover:bg-accent hover:text-black"
                  onClick={() => onAddToPlaylist(attachment)}
                />
                {!attachment.previewOnly ? (
                  <IconButton
                    label={`Download ${attachment.name}`}
                    icon={Download}
                    size="sm"
                    className="bg-black/60 text-white hover:bg-accent hover:text-black"
                    onClick={() => onDownload(attachment)}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {playable.length > 0 ? (
        <div className="mt-3 space-y-2">
          {playable.map((attachment) => {
            const Icon = KIND_ICON[attachment.kind];
            return (
              <div
                key={attachment.path}
                className="group flex w-full items-center gap-3 rounded-lg border border-line/70 bg-base/20 px-3 py-2.5 transition hover:border-accent/30 hover:bg-base/40"
              >
                <button
                  type="button"
                  onClick={() => onPlay(attachment)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-ink">
                      {attachment.name}
                    </span>
                    <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-muted">
                      {attachment.kind}
                      {attachment.previewOnly ? " · preview only" : ""}
                    </span>
                    <AttachmentMeta attachment={attachment} />
                  </span>
                </button>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    label="Add to queue"
                    icon={ListMusic}
                    size="sm"
                    onClick={() => onQueue(attachment)}
                  />
                  <IconButton
                    label="Add to playlist"
                    icon={ListPlus}
                    size="sm"
                    onClick={() => onAddToPlaylist(attachment)}
                  />
                  {!attachment.previewOnly ? (
                    <IconButton
                      label="Download"
                      icon={Download}
                      size="sm"
                      onClick={() => onDownload(attachment)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className="mt-3 space-y-2">
          {documents.map((attachment) => (
            <div
              key={attachment.path}
              className="flex w-full items-center gap-3 rounded-lg border border-line/70 bg-base/20 px-3 py-2.5 transition hover:border-accent/30 hover:bg-base/40"
            >
              <button
                type="button"
                onClick={() => onOpenFile(attachment)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-muted">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-ink">
                    {attachment.name}
                  </span>
                  <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-muted">
                    {attachment.kind}
                  </span>
                  <AttachmentMeta attachment={attachment} />
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-muted" />
              </button>
              {!attachment.previewOnly ? (
                <IconButton
                  label="Download"
                  icon={Download}
                  size="sm"
                  onClick={() => onDownload(attachment)}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
