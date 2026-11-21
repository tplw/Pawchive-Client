import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "../../../shared/types";
import { api } from "../../../shared/api";
import { withProviderPassword } from "../../../shared/lib/providerPasswords";
import {
  isMegaFileUrl,
  needsMediaResolution,
} from "../../player/model/queue";

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
  const triedDirect = useRef(false);
  const imageUrl = image?.url;
  const thumbnailUrl = image?.thumbnailUrl;

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    triedDirect.current = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setProgress(null);
    setDisplaySrc(thumbnailUrl ?? null);
    setFailed(false);

    const loadFromNetwork = async () => {
      try {
        // MEGA links are encrypted file pages, and Drive/Dropbox/GoFile hide
        // the direct file behind a provider API. Resolve them to the loopback
        // server before fetching, just like the player does.
        const src = needsMediaResolution(imageUrl)
          ? (
              await withProviderPassword(imageUrl, () =>
                api.resolveMedia(imageUrl),
              )
            ).url
          : imageUrl;
        const response = await fetch(src, {
          signal: controller.signal,
          cache: "force-cache",
        });
        if (!response.ok) {
          if (!cancelled) {
            setDisplaySrc(thumbnailUrl ?? imageUrl);
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
        setDisplaySrc(imageUrl);
      }
    };

    let unlisten: (() => void) | undefined;
    let cacheRequestId: string | null = null;
    if (
      cacheMedia &&
      imageUrl.startsWith("https://") &&
      !isMegaFileUrl(imageUrl)
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
        .cacheMedia(imageUrl, requestId)
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
  }, [cacheMedia, imageUrl, thumbnailUrl, index]);

  const handleImageError = useCallback(() => {
    // A blob can finish downloading and still fail to decode. Try the full
    // URL once before showing the thumbnail, otherwise the viewer silently
    // stays on the low-resolution image.
    if (imageUrl && displaySrc !== imageUrl && !triedDirect.current) {
      triedDirect.current = true;
      setDisplaySrc(imageUrl);
      return;
    }
    if (thumbnailUrl && displaySrc !== thumbnailUrl) {
      setDisplaySrc(thumbnailUrl);
      return;
    }
    setFailed(true);
  }, [displaySrc, imageUrl, thumbnailUrl]);

  return {
    displaySrc,
    progress,
    failed,
    handleImageError,
  };
}
