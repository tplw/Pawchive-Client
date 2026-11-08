import type {
  Attachment,
  MediaKind,
  MediaProvider,
  PlaylistItem,
  QueueItem,
} from "../types";

const MEGA_FILE_PATTERN =
  /^https:\/\/(?:www\.)?mega\.(?:nz|co\.nz|io)\/(?:file\/[a-z0-9_-]+#|#![a-z0-9_-]+!)/i;

/** MEGA links need backend decryption before the webview can play them. */
export function isMegaFileUrl(url: string): boolean {
  return MEGA_FILE_PATTERN.test(url);
}

/** Providers whose links need a backend lookup before playback. */
export function needsMediaResolution(url: string): boolean {
  const provider = providerForUrl(url);
  return (
    provider === "mega" ||
    provider === "googleDrive" ||
    provider === "dropbox" ||
    provider === "gofile"
  );
}

/** Mirror of the backend provider classifier for URLs built in the UI. */
export function providerForUrl(url: string): MediaProvider {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "pawchive";
  }
  if (host === "pawchive.pw" || host.endsWith(".pawchive.pw")) {
    return "pawchive";
  }
  if (/^(?:www\.)?mega\.(?:nz|co\.nz|io)$/.test(host)) {
    return "mega";
  }
  if (
    host === "drive.google.com" ||
    host === "drive.usercontent.google.com" ||
    host === "docs.google.com"
  ) {
    return "googleDrive";
  }
  if (
    host === "dropbox.com" ||
    host.endsWith(".dropbox.com") ||
    host.endsWith(".dropboxusercontent.com")
  ) {
    return "dropbox";
  }
  if (host === "gofile.io" || host.endsWith(".gofile.io")) {
    return "gofile";
  }
  return "external";
}

/** Only audio and video belong in the player; images use the image viewer. */
export function isPlayableMediaKind(kind: MediaKind): boolean {
  return kind === "audio" || kind === "video";
}

/**
 * Stable key for resume positions. The same media can be opened from a post,
 * a playlist or the Downloads page, where `filePath` may be relative, absolute
 * or a URL. Using the archive-relative media path keeps those entries in sync.
 */
export function playbackProgressKey(item: Pick<QueueItem, "url" | "filePath">): string {
  const storedPath = item.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath =
    /^(?:Users|var|private|home|tmp|Volumes|mnt)\//i.test(storedPath) ||
    /^[a-z]:\//i.test(storedPath);
  if (storedPath && !absolutePath && !/^https?:\/\//i.test(storedPath)) {
    return storedPath;
  }
  try {
    const url = new URL(item.url);
    const path = decodeURIComponent(url.pathname)
      .replace(/^\/data\/?/, "")
      .replace(/^\/+/, "");
    if (path) {
      return url.hostname.endsWith("pawchive.pw")
        ? path
        : `${url.hostname}/${path}`;
    }
  } catch {
    // Local or malformed URLs fall back to the stored file path.
  }
  return item.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function queueItemFromAttachment(
  attachment: Attachment,
  context: {
    title: string;
    creatorName: string;
    artwork: string | null;
    service: string;
    creatorId: string;
    postId: string;
  },
): QueueItem {
  return {
    id: `${context.service}:${context.creatorId}:${context.postId}:${attachment.path}`,
    url: attachment.url,
    downloadUrl: attachment.downloadUrl ?? attachment.url,
    filePath: attachment.path,
    fileName: attachment.name,
    mediaKind: attachment.kind,
    title: context.title,
    creatorName: context.creatorName,
    artwork: attachment.thumbnailUrl ?? context.artwork,
    service: context.service,
    creatorId: context.creatorId,
    postId: context.postId,
  };
}

export function queueItemFromPlaylistItem(item: PlaylistItem): QueueItem {
  return {
    id: `${item.service}:${item.creatorId}:${item.postId}:${item.mediaPath}`,
    url: item.mediaUrl,
    downloadUrl: null,
    localPath: item.localPath ?? null,
    filePath: item.mediaPath,
    fileName: item.mediaPath.split("/").pop() ?? item.title,
    mediaKind: item.mediaKind,
    title: item.title,
    creatorName: item.creatorName,
    artwork:
      item.thumbnailUrl ??
      (item.mediaKind === "image" ? item.mediaUrl : null),
    service: item.service,
    creatorId: item.creatorId,
    postId: item.postId,
  };
}
