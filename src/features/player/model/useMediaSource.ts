import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { QueueItem } from "../../../shared/types";
import { errorMessage } from "../../../shared/lib/constants";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import { isMegaFileUrl, needsMediaResolution } from "./queue";
import { withProviderPassword } from "../../../shared/lib/providerPasswords";

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

const UNSUPPORTED_MEDIA =
  "This container or codec is not supported by the system webview. Try another attachment or a dedicated player.";
const INTERRUPTED_MEDIA =
  "The stream was interrupted. Check the connection and retry.";
const GENERIC_MEDIA_ERROR = "The media could not be played.";

/**
 * Resolve and load the current queue item into the persistent video element.
 * Owns source, loading and error state plus the resume position handshake with
 * the metadata event.
 */
export function useMediaSource({
  item,
  videoRef,
  resumeRef,
  loadedItemRef,
  source,
  setSource,
  setLoading,
  setError,
  setVideoAspect,
  setVideoReady,
  setPosition,
  setDuration,
  setPlaying,
  startTranscode,
}: {
  item: QueueItem | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  resumeRef: RefObject<number>;
  loadedItemRef: RefObject<string | null>;
  source: string | null;
  setSource: (source: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setVideoAspect: (aspect: number | null) => void;
  setVideoReady: (ready: boolean) => void;
  setPosition: (current: number, duration: number) => void;
  setDuration: (duration: number) => void;
  setPlaying: (playing: boolean) => void;
  startTranscode: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const settings = useAppStore((state) => state.settings);
  const hlsFallbackRef = useRef<string | null>(null);
  const proxyFallbackRef = useRef<string | null>(null);
  const previousItemRef = useRef<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setVideoReady(false);
  }, [item?.id, source, setVideoReady]);

  useEffect(() => {
    hlsFallbackRef.current = null;
    proxyFallbackRef.current = null;
  }, [item?.id]);

  useEffect(() => {
    if (!item) {
      setSource(null);
      setLoading(false);
      setError(null);
      setVideoAspect(null);
      loadedItemRef.current = null;
      return;
    }
    let cancelled = false;
    // Read at load time so changing these settings does not restart the
    // current source and lose the playback position.
    const { cacheMedia } = useAppStore.getState().settings;
    setSource(null);
    setError(null);
    setLoading(true);
    setVideoAspect(null);
    if (previousItemRef.current !== item.id) {
      previousItemRef.current = item.id;
      resumeRef.current = 0;
    }
    loadedItemRef.current = null;

    const loadRemote = () => {
      // MEGA links are encrypted pages, while Drive, Dropbox and GoFile hide
      // the direct file behind provider-specific APIs. The backend resolves
      // them and returns a loopback URL with the same HTTP Range support as
      // locally cached Pawchive media.
      if (needsMediaResolution(item.url)) {
        void withProviderPassword(item.url, () => api.resolveMedia(item.url))
          .then((media) => {
            if (!cancelled) setSource(media.url);
          })
          .catch((validationError) => {
            if (cancelled) return;
            setLoading(false);
            setError(errorMessage(validationError));
          });
        return;
      }
      void api
        .validateMedia(item.url)
        .then((url) => {
          if (!cancelled) setSource(url);
        })
        .catch((validationError) => {
          if (cancelled) return;
          setLoading(false);
          setError(errorMessage(validationError));
        });
    };

    if (item.localPath) {
      void api
        .localMediaUrl(item.localPath)
        .then((url) => {
          if (!cancelled) setSource(url);
        })
        .catch(() => {
          if (!cancelled) loadRemote();
        });
    } else if (isMegaFileUrl(item.url)) {
      loadRemote();
    } else if (
      cacheMedia &&
      !isHlsUrl(item.url) &&
      item.url.startsWith("https://")
    ) {
      void api
        .getCachedMediaUrl(item.downloadUrl ?? item.url)
        .then((cached) => {
          if (cancelled) return;
          if (cached) {
            setSource(cached);
            return;
          }
          loadRemote();
          // Do not cache while streaming: the cache download would compete
          // with playback and make the first view slower.
        })
        .catch(() => {
          if (!cancelled) loadRemote();
        });
    } else {
      loadRemote();
    }

    return () => {
      cancelled = true;
    };
  }, [
    item,
    loadedItemRef,
    resumeRef,
    setError,
    setLoading,
    setSource,
    setVideoAspect,
    reloadToken,
  ]);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (video && Number.isFinite(video.currentTime) && video.currentTime > 0) {
      resumeRef.current = video.currentTime;
    }
    hlsFallbackRef.current = null;
    proxyFallbackRef.current = null;
    setError(null);
    setLoading(true);
    setReloadToken((value) => value + 1);
  }, [hlsFallbackRef, resumeRef, setError, setLoading, videoRef]);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !item) return;
    loadedItemRef.current = item.id;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspect(video.videoWidth / video.videoHeight);
    }
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(total);
    const resume = resumeRef.current;
    resumeRef.current = 0;
    if (
      settings.resumePlayback &&
      resume > 5 &&
      (!total || resume < total - 8)
    ) {
      try {
        video.currentTime = resume;
        setPosition(resume, total);
      } catch {
        // Start from the beginning when seeking is unsupported.
      }
    }
    setLoading(false);
  }, [
    item,
    loadedItemRef,
    resumeRef,
    setDuration,
    setLoading,
    setPosition,
    setVideoAspect,
    settings.resumePlayback,
    videoRef,
  ]);

  const onError = useCallback(() => {
    const code = videoRef.current?.error?.code;
    // Some webviews (notably WebView2) have no native HLS support. When the
    // archive gave us a direct download URL, retry once with that before
    // surfacing an error.
    if (
      item &&
      isHlsUrl(item.url) &&
      item.downloadUrl &&
      item.downloadUrl !== item.url &&
      !isHlsUrl(item.downloadUrl) &&
      hlsFallbackRef.current !== item.id
    ) {
      hlsFallbackRef.current = item.id;
      setSource(item.downloadUrl);
      setError(null);
      setLoading(true);
      setPlaying(true);
      return;
    }
    if (
      settings.transcodeMedia &&
      item &&
      item.url.startsWith("https://") &&
      (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
        code === MediaError.MEDIA_ERR_DECODE)
    ) {
      startTranscode();
      return;
    }

    const directUrl = item?.downloadUrl ?? item?.url;
    const canProxy =
      Boolean(item) &&
      Boolean(directUrl?.startsWith("https://")) &&
      !item?.localPath &&
      !isHlsUrl(item?.url ?? "") &&
      !source?.startsWith("http://127.0.0.1") &&
      (code === undefined ||
        code === 0 ||
        code === MediaError.MEDIA_ERR_ABORTED ||
        code === MediaError.MEDIA_ERR_NETWORK ||
        code === MediaError.MEDIA_ERR_DECODE);

    const message =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? UNSUPPORTED_MEDIA
        : code === MediaError.MEDIA_ERR_NETWORK
          ? INTERRUPTED_MEDIA
          : code === MediaError.MEDIA_ERR_DECODE
            ? "The media stream could not be decoded. Retrying may help if the file was interrupted."
            : GENERIC_MEDIA_ERROR;

    const fail = (finalMessage: string) => {
      setError(finalMessage);
      setLoading(false);
      setPlaying(false);
      toast("error", "Playback failed", finalMessage);
    };

    if (canProxy && item && directUrl) {
      const video = videoRef.current;
      if (video && Number.isFinite(video.currentTime) && video.currentTime > 0) {
        resumeRef.current = video.currentTime;
      }
      proxyFallbackRef.current = item.id;
      setError(null);
      setLoading(true);
      setPlaying(true);
      void withProviderPassword(directUrl, () => api.resolveMedia(directUrl))
        .then((media) => {
          if (proxyFallbackRef.current !== item.id) return;
          setSource(media.url);
        })
        .catch(() => {
          if (proxyFallbackRef.current === item.id) fail(message);
        });
      return;
    }

    fail(message);
  }, [
    hlsFallbackRef,
    item,
    proxyFallbackRef,
    resumeRef,
    setError,
    setLoading,
    setPlaying,
    setSource,
    settings.transcodeMedia,
    source,
    startTranscode,
    toast,
    videoRef,
  ]);

  return { onLoadedMetadata, onError, retry };
}
