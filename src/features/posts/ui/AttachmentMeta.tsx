import { useEffect, useState } from "react";
import { api } from "../../../services/api";
import { cn, formatBytes, MEDIA_PROVIDER_LABELS } from "../../../lib/format";
import { needsMediaResolution } from "../../../player/queue";
import type { Attachment } from "../../../types";

const mediaSizeCache = new Map<string, Promise<number | null>>();
const resolutionCache = new Map<
  string,
  { width: number; height: number } | null
>();

function mediaSize(url: string): Promise<number | null> {
  const cached = mediaSizeCache.get(url);
  if (cached) return cached;
  const pending = api.getMediaSize(url).catch(() => null);
  mediaSizeCache.set(url, pending);
  return pending;
}

function videoResolution(
  url: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const finish = (size: { width: number; height: number } | null) => {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Best-effort decoder release.
      }
      resolve(size);
    };
    video.onloadedmetadata = () => {
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export function AttachmentMeta({
  attachment,
  className,
}: {
  attachment: Attachment;
  className?: string;
}) {
  const [size, setSize] = useState<number | null>(null);
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mediaSize(attachment.downloadUrl ?? attachment.url).then((value) => {
      if (!cancelled) setSize(value);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.downloadUrl, attachment.url]);

  useEffect(() => {
    if (attachment.kind !== "video" && attachment.kind !== "image") return;
    let cancelled = false;
    const key = `${attachment.kind}:${attachment.url}`;
    const cached = resolutionCache.get(key);
    if (cached !== undefined) {
      setResolution(cached);
      return;
    }
    const load =
      attachment.kind === "video"
        ? (async () => {
            // Provider pages are HTML, so read dimensions from the resolved
            // loopback stream instead of the share link.
            let source = attachment.url;
            if (needsMediaResolution(source)) {
              const media = await api.resolveMedia(source).catch(() => null);
              if (media) source = media.url;
            }
            return videoResolution(source);
          })()
        : api
            .getImageDimensions(attachment.url)
            .then((value) => value ?? null)
            .catch(() => null);
    void load.then((value) => {
      resolutionCache.set(key, value);
      if (!cancelled) setResolution(value);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.kind, attachment.thumbnailUrl, attachment.url]);

  const parts: string[] = [MEDIA_PROVIDER_LABELS[attachment.provider]];
  if (resolution) parts.push(`${resolution.width}×${resolution.height}`);
  if (size) parts.push(formatBytes(size));
  return (
    <span
      className={cn(
        "mt-0.5 block text-[9px] tabular-nums text-dim",
        className,
      )}
    >
      {parts.join(" · ")}
    </span>
  );
}

