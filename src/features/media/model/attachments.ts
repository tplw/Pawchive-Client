import type {
  Attachment,
  DownloadRecord,
  PlaylistItem,
  QueueItem,
} from "../../../shared/types";
import { providerForUrl } from "./providers";

/** Build the image-viewer attachment for a playlist item. */
export function attachmentFromPlaylistItem(
  item: PlaylistItem,
  displayUrl: string,
): Attachment {
  const fileName = item.mediaPath.split("/").pop() ?? item.title;
  return {
    name: item.title || fileName,
    path: item.mediaPath,
    url: displayUrl,
    thumbnailUrl: item.thumbnailUrl ?? item.mediaUrl,
    kind: "image",
    provider: providerForUrl(displayUrl),
    ext: fileName.split(".").pop() ?? "",
    previewOnly: false,
  };
}

/**
 * Build the image-viewer attachment for a completed download. When the local
 * file URL is not ready, keep the original full media URL as the viewer source.
 * The thumbnail must only ever be preview art; using it as the source would
 * leave the viewer showing the low-resolution image after the fetch finishes.
 */
export function attachmentFromDownload(
  record: DownloadRecord,
  displayUrl: string | null,
): Attachment {
  const source = displayUrl ?? record.url;
  return {
    name: record.title || record.fileName,
    path: record.filePath,
    url: source,
    thumbnailUrl: record.thumbnailUrl ?? record.url,
    kind: "image",
    provider: providerForUrl(source),
    ext: record.fileName.split(".").pop() ?? "",
    previewOnly: false,
  };
}

/** Build a queue item for a completed download. */
export function queueItemFromDownload(record: DownloadRecord): QueueItem {
  return {
    id: record.id,
    url: record.url,
    localPath: record.filePath,
    filePath: record.filePath,
    fileName: record.fileName,
    mediaKind: record.mediaKind,
    title: record.title || record.fileName,
    creatorName: record.creatorName,
    artwork:
      record.thumbnailUrl ??
      (record.mediaKind === "image" ? record.url : null),
    service: record.service,
    creatorId: record.creatorId,
    postId: record.postId,
  };
}
