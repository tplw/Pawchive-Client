import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "../../../types";
import { api } from "../../../services/api";
import {
  isMegaFileUrl,
  needsMediaResolution,
} from "../../../player/queue";

/**
 * Load the current image for the viewer. Cached images win; otherwise the
 * image streams into an object URL so progress can be reported. Resolved
 * provider links (MEGA, Drive, Dropbox, GoFile) go through the backend first.
 */
export function useImageViewerSource({
  image,
  index,
  cacheMedia,
}: {
  image: Attachment | undefined;
  index: number;
  cacheMedia: boolean;
}) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setProgress(null);
    setDisplaySrc(image.thumbnailUrl ?? null);
    setFailed(false);

    const loadFromNetwork = async () => {
      try {
        // MEGA links are encrypted file pages, and Drive/Dropbox/GoFile hide
        // the direct file behind a provider API. Resolve them to the loopback
        // server before fetching, just like the player does.
        const src = needsMediaResolution(image.url)
          ? (await api.resolveMedia(image.url)).url
          : image.url;
        const response = await fetch(src, {
          signal: controller.signal,
          cache: "force-cache",
        });
        if (!response.ok) {
          if (!cancelled) {
            setDisplaySrc(image.thumbnailUrl ?? image.url);
          }
          return;
        }
        const total = Number(response.headers.get("content-length")) || 0;
        if (!response.body) {
          const blob = await response.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setDisplaySrc(objectUrl);
          return;
        }

        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        if (total > 0) setProgress(0);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          received += value.byteLength;
          if (total > 0 && !cancelled) {
            setProgress(Math.min(99, Math.round((received / total) * 100)));
          }
        }
        if (cancelled) return;
        const blob = new Blob(chunks, {
          type: response.headers.get("content-type") ?? undefined,
        });
        objectUrl = URL.createObjectURL(blob);
        setDisplaySrc(objectUrl);
        setProgress(100);
        window.setTimeout(() => {
          if (!cancelled) setProgress(null);
        }, 250);
      } catch (error) {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setProgress(null);
        setDisplaySrc(image.url);
      }
    };

    let unlisten: (() => void) | undefined;
    let cacheRequestId: string | null = null;
    if (
      cacheMedia &&
      image.url.startsWith("https://") &&
      !isMegaFileUrl(image.url)
    ) {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cacheRequestId = requestId;
      setProgress(0);
      void listen<{
        requestId?: string;
        downloaded: number;
        total?: number | null;
      }>("media-cache://progress", (event) => {
        if (
          cancelled ||
          event.payload.requestId !== requestId ||
          !event.payload.total
        ) {
          return;
        }
        setProgress(
          Math.min(
            99,
            Math.round(
              (event.payload.downloaded / event.payload.total) * 100,
            ),
          ),
        );
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      void api
        .cacheMedia(image.url, requestId)
        .then((url) => {
          if (cancelled) return;
          setDisplaySrc(url);
          setProgress(100);
          window.setTimeout(() => {
            if (!cancelled) setProgress(null);
          }, 250);
        })
        .catch(() => {
          if (cancelled) return;
          setProgress(null);
          void loadFromNetwork();
        });
    } else {
      void loadFromNetwork();
    }

    return () => {
      cancelled = true;
      controller.abort();
      unlisten?.();
      if (cacheRequestId) {
        void api.cancelRequest(cacheRequestId).catch(() => undefined);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheMedia, image, index]);

  const handleImageError = useCallback(() => {
    if (image?.thumbnailUrl && displaySrc !== image.thumbnailUrl) {
      setDisplaySrc(image.thumbnailUrl);
      return;
    }
    setFailed(true);
  }, [displaySrc, image?.thumbnailUrl]);

  return {
    displaySrc,
    progress,
    failed,
    handleImageError,
  };
}
