import {
  Expand,
  ListMusic,
  LoaderCircle,
  Maximize,
  Minimize,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentWindow } from "../lib/window";
import { api } from "../services/api";
import { SPEEDS, errorMessage } from "../lib/constants";
import { cn, formatDuration } from "../lib/format";
import { useIsLandscape } from "../lib/orientation";
import { isIos, isMobile } from "../lib/platform";
import { navigate } from "../lib/router";
import { useAppStore } from "../stores/app";
import {
  isMegaFileUrl,
  isPlayableMediaKind,
  needsMediaResolution,
  playbackProgressKey,
} from "./queue";
import { cachedProgress, rememberProgress } from "./progress";
import { usePlayerStore } from "./store";
import type { PlaylistItemInput } from "../types";

import { Button, IconButton } from "../components/ui";
import { PlaylistPicker } from "../components/PlaylistPicker";
import { SeekBar, SpeedButton, VolumeControl } from "../features/player/ui/Controls";
import { CompactQueuePanel, QueuePanel } from "../features/player/ui/Queue";
import { useMediaSession } from "../features/player/model/useMediaSession";
import { usePlayerKeyboard } from "../features/player/model/usePlayerKeyboard";
import { useSeekEvent } from "../features/player/model/useSeekEvent";

function isHlsUrl(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

export function Player() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef(0);
  // Which queue item the media element currently holds. `progressKey` can
  // change before the element has switched sources, so seek/save operations
  // must confirm the element really belongs to the item they refer to.
  const loadedItemRef = useRef<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showQueue, setShowQueue] = useState(false);
  const [transcodeProgress, setTranscodeProgress] = useState<number | null>(null);
  const [transcodePhase, setTranscodePhase] = useState<
    "download" | "transcode" | null
  >(null);
  const transcodeRequestRef = useRef<string | null>(null);
  const transcodeAttemptedRef = useRef<string | null>(null);
  const hlsFallbackRef = useRef<string | null>(null);
  const isLandscape = useIsLandscape();
  const [playlistItem, setPlaylistItem] = useState<PlaylistItemInput | null>(null);

  const queue = usePlayerStore((state) => state.queue);
  const currentId = usePlayerStore((state) => state.currentId);
  const playing = usePlayerStore((state) => state.playing);
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const speed = usePlayerStore((state) => state.speed);
  const expanded = usePlayerStore((state) => state.expanded);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const buffered = usePlayerStore((state) => state.buffered);

  const setExpanded = usePlayerStore((state) => state.setExpanded);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const setPosition = usePlayerStore((state) => state.setPosition);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setBuffered = usePlayerStore((state) => state.setBuffered);
  const setSpeed = usePlayerStore((state) => state.setSpeed);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const seek = usePlayerStore((state) => state.seek);
  const clear = usePlayerStore((state) => state.clear);

  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const toast = useAppStore((state) => state.toast);
  const lastSaved = useRef({
    volume: settings.volume,
    speed: settings.playbackSpeed,
  });

  const item = useMemo(() => {
    const current = queue.find((entry) => entry.id === currentId) ?? null;
    return current && isPlayableMediaKind(current.mediaKind) ? current : null;
  }, [queue, currentId]);
  const progressKey = item ? playbackProgressKey(item) : null;
  const progressKeys = useMemo(
    () =>
      [...new Set([progressKey, item?.filePath, item?.localPath])].filter(
        (key): key is string => Boolean(key),
      ),
    [item?.filePath, item?.localPath, progressKey],
  );
  const isAudio = item?.mediaKind === "audio";
  const transcodeText = transcodePhase
    ? `${transcodePhase === "download" ? "Downloading" : "Transcoding"}${
        transcodeProgress !== null
          ? ` ${Math.round(transcodeProgress)}%`
          : "…"
      }`
    : null;
  const autoHideControls =
    expanded && !isAudio && (fullscreen || (isMobile && isLandscape));
  const hideStatusBar =
    isIos && expanded && !isAudio && (isLandscape || fullscreen);

  useEffect(() => {
    if (!isIos) return;
    void api.setStatusBarHidden(hideStatusBar).catch(() => undefined);
  }, [hideStatusBar]);

  useEffect(() => {
    if (!isIos) return;
    return () => {
      void api.setStatusBarHidden(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const container = stageContainerRef.current;
    if (!container) return;
    const update = () =>
      setStageBounds({
        width: container.clientWidth,
        height: Math.max(0, container.clientHeight),
      });
    update();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    observer?.observe(container);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [expanded]);

  useEffect(() => {
    setControlsVisible(true);
  }, [expanded, item?.id]);

  useEffect(() => {
    setVideoReady(false);
  }, [item?.id, source]);

  useEffect(() => {
    if (!autoHideControls) setControlsVisible(true);
  }, [autoHideControls]);

  useEffect(() => {
    // The buffering indicator lives in the controls, so keep them visible
    // while the stream is stalled.
    if (loading) setControlsVisible(true);
  }, [loading]);

  useEffect(() => {
    if (!autoHideControls || !controlsVisible || showQueue || loading) return;
    const timer = window.setTimeout(() => setControlsVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [autoHideControls, controlsVisible, showQueue, item?.id, loading]);

  useEffect(() => {
    transcodeAttemptedRef.current = null;
    setTranscodeProgress(null);
    setTranscodePhase(null);
    return () => {
      const pending = transcodeRequestRef.current;
      transcodeRequestRef.current = null;
      if (pending) void api.cancelRequest(pending).catch(() => undefined);
    };
  }, [item?.id]);

  useEffect(() => {
    hlsFallbackRef.current = null;
  }, [item?.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{
      requestId?: string;
      phase: string;
      percent?: number | null;
    }>("transcode://progress", (event) => {
      if (event.payload.requestId !== transcodeRequestRef.current) return;
      setTranscodePhase(
        event.payload.phase === "download" ? "download" : "transcode",
      );
      setTranscodeProgress(event.payload.percent ?? null);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const closeQueue = () => setShowQueue(false);
    window.addEventListener("pawchive:close-queue", closeQueue);
    window.addEventListener("hashchange", closeQueue);
    return () => {
      window.removeEventListener("pawchive:close-queue", closeQueue);
      window.removeEventListener("hashchange", closeQueue);
    };
  }, []);

  const saveProgress = useCallback(() => {
    if (!progressKey || !item || loadedItemRef.current !== item.id) return;
    const video = videoRef.current;
    const state = usePlayerStore.getState();
    const position =
      video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : state.currentTime;
    const total =
      video && Number.isFinite(video.duration) ? video.duration : state.duration;
    if (!Number.isFinite(position) || position < 3) return;
    const progress = {
      filePath: progressKey,
      position,
      duration: Number.isFinite(total) ? total : 0,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    rememberProgress(progress);
    void api.saveProgress(progress).catch(() => undefined);
  }, [item, progressKey]);

  const startTranscode = useCallback(async () => {
    if (!item) return;
    if (transcodeAttemptedRef.current === item.id) return;
    transcodeAttemptedRef.current = item.id;
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    transcodeRequestRef.current = requestId;
    setError(null);
    setSource(null);
    setLoading(true);
    setTranscodePhase("download");
    setTranscodeProgress(0);
    try {
      const localUrl = await api.transcodeMedia(
        item.downloadUrl ?? item.url,
        requestId,
      );
      if (transcodeRequestRef.current !== requestId) return;
      transcodeRequestRef.current = null;
      setSource(localUrl);
      setError(null);
      setLoading(true);
      setPlaying(true);
      setTranscodePhase(null);
      setTranscodeProgress(null);
    } catch (transcodeError) {
      if (transcodeRequestRef.current !== requestId) return;
      transcodeRequestRef.current = null;
      const message = errorMessage(transcodeError);
      setError(message);
      setLoading(false);
      setPlaying(false);
      setTranscodePhase(null);
      setTranscodeProgress(null);
      toast("error", "Transcoding failed", message);
    }
  }, [item, setPlaying, toast]);

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
    const { cacheMedia, resumePlayback } = useAppStore.getState().settings;
    setSource(null);
    setError(null);
    setLoading(true);
    setVideoAspect(null);
    resumeRef.current = 0;
    loadedItemRef.current = null;

    const loadRemote = () => {
      // MEGA links are encrypted pages, while Drive, Dropbox and GoFile hide
      // the direct file behind provider-specific APIs. The backend resolves
      // them and returns a loopback URL with the same HTTP Range support as
      // locally cached Pawchive media.
      if (needsMediaResolution(item.url)) {
        void api
          .resolveMedia(item.url)
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

    if (resumePlayback && progressKeys.length > 0) {
      void (async () => {
        for (const key of progressKeys) {
          const progress =
            cachedProgress(key) ??
            (await api.getProgress(key).catch(() => null));
          if (cancelled) return;
          if (!progress) continue;
          rememberProgress(progress);
          if (progress.position <= 5) continue;
          const video = videoRef.current;
          // The element still holds the outgoing item until its metadata
          // loads. Only seek directly when it belongs to this item; otherwise
          // stash the position for onLoadedMetadata to apply.
          if (
            !video ||
            loadedItemRef.current !== item.id ||
            video.readyState < 1
          ) {
            resumeRef.current = progress.position;
            return;
          }
          const total = Number.isFinite(video.duration) ? video.duration : 0;
          if (total && progress.position >= total - 8) return;
          try {
            video.currentTime = progress.position;
            setPosition(progress.position, total);
          } catch {
            // Seeking can fail for unusual containers; start from the beginning.
          }
          return;
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [item, progressKeys, setPosition]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = muted ? 0 : volume;
    video.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item || !source) return;
    if (playing) {
      void video.play().catch(() => {
        // Keep the play intent; onCanPlay retries when the element is ready.
        setLoading(true);
      });
    } else {
      video.pause();
    }
  }, [playing, item, source, setPlaying]);

  useEffect(() => {
    if (!item) return;
    const timer = window.setInterval(() => {
      if (usePlayerStore.getState().playing) saveProgress();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      saveProgress();
    };
  }, [item, saveProgress]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveProgress();
    };
    const onSave = () => saveProgress();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pawchive:save-progress", onSave);
    window.addEventListener("pagehide", onSave);
    window.addEventListener("beforeunload", onSave);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pawchive:save-progress", onSave);
      window.removeEventListener("pagehide", onSave);
      window.removeEventListener("beforeunload", onSave);
    };
  }, [saveProgress]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (
        lastSaved.current.volume === volume &&
        lastSaved.current.speed === speed
      ) {
        return;
      }
      lastSaved.current = { volume, speed };
      void saveSettings({ volume, playbackSpeed: speed });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [volume, speed, saveSettings]);

  useEffect(() => {
    const win = currentWindow();
    if (!win) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win.isFullscreen().then(setFullscreen).catch(() => undefined);
    };
    sync();
    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useMediaSession(item);

  useSeekEvent(videoRef);

  const toggleFullscreen = useCallback(async () => {
    const win = currentWindow();
    if (!win) {
      toast("info", "Fullscreen is unavailable", "This environment does not expose a desktop window.");
      return;
    }
    try {
      const current = await win.isFullscreen().catch(() => fullscreen);
      const next = !current;
      await win.setFullscreen(next);
      setFullscreen(next);
    } catch (fullscreenError) {
      toast("error", "Could not change fullscreen", errorMessage(fullscreenError));
    }
  }, [fullscreen, toast]);

  const forcePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) {
      try {
        video.currentTime = 0;
      } catch {
        // Ignore seek errors and let play() decide.
      }
    }
    const attempt = () => {
      if (!usePlayerStore.getState().playing) return;
      void video.play().catch(() => {
        // Keep the user's play intent. onCanPlay retries once data is ready.
        setLoading(true);
      });
    };
    attempt();
    if (video.readyState < 2) {
      const retry = () => {
        video.removeEventListener("canplay", retry);
        attempt();
      };
      video.addEventListener("canplay", retry, { once: true });
    }
  }, []);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      usePlayerStore.getState().toggle();
      return;
    }
    // Use the actual element state, not just the store. If the UI and media
    // element ever drift out of sync, the first press still forces playback.
    if (video.paused) {
      setPlaying(true);
      forcePlayback();
    } else {
      setPlaying(false);
      video.pause();
    }
  }, [forcePlayback, setPlaying]);

  usePlayerKeyboard({
    fullscreen,
    setFullscreen,
    toggleFullscreen,
    togglePlayback,
  });

  const collapse = useCallback(() => {
    saveProgress();
    setShowQueue(false);
    if (fullscreen) {
      const win = currentWindow();
      if (win) {
        void win
          .setFullscreen(false)
          .then(() => setFullscreen(false))
          .catch(() => undefined);
      }
    }
    setExpanded(false);
  }, [fullscreen, saveProgress, setExpanded]);

  const stopPlayback = useCallback(() => {
    saveProgress();
    clear();
  }, [clear, saveProgress]);

  if (!item) {
    return expanded ? (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-[#0b0910] text-white">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/6 text-white/40">
            <Music2 className="h-7 w-7" />
          </div>
          <p className="mt-4 text-sm font-medium">Nothing is playing</p>
          <p className="mt-1 text-xs text-white/45">
            Open a post and play an audio or video attachment.
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={collapse}
          >
            Close player
          </Button>
        </div>
      </div>
    ) : null;
  }

  const openOriginalPost = () => {
    if (!item.postId) return;
    if (expanded) collapse();
    navigate({
      name: "post",
      service: item.service,
      creatorId: item.creatorId,
      postId: item.postId,
    });
  };

  const openCreator = () => {
    if (!item.service || !item.creatorId) return;
    if (expanded) collapse();
    navigate({
      name: "creator",
      service: item.service,
      creatorId: item.creatorId,
    });
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
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
  };

  const onError = () => {
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
        code === MediaError.MEDIA_ERR_DECODE) &&
      transcodeAttemptedRef.current !== item.id
    ) {
      void startTranscode();
      return;
    }
    const message =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? "This container or codec is not supported by the system webview. Try another attachment or a dedicated player."
        : code === MediaError.MEDIA_ERR_NETWORK
          ? "The stream was interrupted. Check the connection and retry."
          : "The media could not be played.";
    setError(message);
    setLoading(false);
    setPlaying(false);
    toast("error", "Playback failed", message);
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (video) setPosition(video.currentTime, video.duration);
  };

  const onProgress = () => {
    const video = videoRef.current;
    if (video && video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }
  };

  const stageAspect = videoAspect ?? 16 / 9;
  let stageWidth = stageBounds.width;
  let stageHeight = stageWidth / stageAspect;
  if (stageBounds.height > 0 && stageHeight > stageBounds.height) {
    stageHeight = stageBounds.height;
    stageWidth = stageHeight * stageAspect;
  }
  const videoStageStyle =
    expanded && !isAudio
      ? stageWidth > 0 && stageHeight > 0
        ? {
            width: `${Math.floor(stageWidth)}px`,
            height: `${Math.floor(stageHeight)}px`,
          }
        : { width: "100%", aspectRatio: "16 / 9" }
      : undefined;

  const onVideoClick = () => {
    if (expanded) {
      if (isAudio) return;
      if (showQueue) {
        setShowQueue(false);
        return;
      }
      // Pressing the media always toggles the controls in the expanded
      // player, including desktop fullscreen where auto-hide is optional.
      setControlsVisible((visible) => !visible);
      return;
    }
    setExpanded(true);
  };

  const mediaStage = (
    <div
      role={!expanded ? "button" : undefined}
      tabIndex={!expanded ? 0 : undefined}
      aria-label={
        !expanded ? (isAudio ? "Expand audio player" : "Expand video player") : undefined
      }
      title={!expanded ? "Expand player" : undefined}
      onClick={!expanded ? () => setExpanded(true) : undefined}
      onKeyDown={
        !expanded
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setExpanded(true);
              }
            }
          : undefined
      }
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-black",
        expanded
          ? isAudio
            ? "absolute inset-0"
            : "max-h-full max-w-full"
          : isAudio
            ? "h-14 w-14 cursor-pointer rounded-lg"
            : "h-14 w-24 cursor-pointer rounded-lg",
      )}
      style={videoStageStyle}
    >
      {isAudio ? (
        <div className="grid h-full w-full place-items-center overflow-hidden">
          {item.artwork ? (
            <img
              src={item.artwork}
              alt=""
              className={cn(
                "h-full w-full object-cover",
                expanded &&
                  "max-h-[58vh] max-w-[58vh] rounded-2xl object-contain shadow-2xl",
              )}
            />
          ) : (
            <div
              className={cn(
                "grid place-items-center bg-[radial-gradient(circle,rgb(var(--accent)/0.28),transparent_70%)]",
                expanded ? "h-72 w-72 rounded-3xl" : "h-full w-full",
              )}
            >
              <Music2
                className={expanded ? "h-20 w-20 text-accent" : "h-5 w-5 text-accent"}
              />
            </div>
          )}
        </div>
      ) : null}
      <video
        ref={videoRef}
        src={source ?? undefined}
        playsInline
        preload="metadata"
        className={cn(
          "absolute inset-0 h-full w-full object-contain",
          isAudio && "hidden",
        )}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={() => setVideoReady(true)}
        onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={onTimeUpdate}
        onProgress={onProgress}
        onWaiting={() => setLoading(true)}
        onStalled={() => setLoading(true)}
        onCanPlay={() => {
          setLoading(false);
          const video = videoRef.current;
          if (video && usePlayerStore.getState().playing && video.paused) {
            void video.play().catch(() => undefined);
          }
        }}
        onPlaying={() => {
          setLoading(false);
          setPlaying(true);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          saveProgress();
        }}
        onEnded={() => {
          saveProgress();
          const cacheUrl = item.downloadUrl ?? item.url;
          if (
            settings.cacheMedia &&
            !isHlsUrl(item.url) &&
            !isMegaFileUrl(cacheUrl) &&
            cacheUrl.startsWith("https://") &&
            !item.localPath
          ) {
            void api.cacheMedia(cacheUrl).catch(() => undefined);
          }
          const state = usePlayerStore.getState();
          const index = state.queue.findIndex((entry) => entry.id === state.currentId);
          if (
            settings.autoplayNext &&
            index >= 0 &&
            index < state.queue.length - 1
          ) {
            state.next(true);
          } else {
            state.setPlaying(false);
          }
        }}
        onError={onError}
        onClick={onVideoClick}
      />

      {!expanded && !isAudio && item.artwork && !videoReady ? (
        <img
          src={item.artwork}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {error ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-5 text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <p
            className={cn(
              "max-w-sm text-white/75",
              expanded ? "text-xs" : "hidden",
            )}
          >
            {error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              setLoading(true);
              videoRef.current?.load();
              setPlaying(true);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}
    </div>
  );

  const bufferingIndicator =
    loading && !error ? (
      <span
        role="status"
        aria-label="Buffering"
        className="inline-flex shrink-0 items-center"
      >
        <LoaderCircle className="h-3 w-3 animate-spin text-white/60" />
      </span>
    ) : null;

  const controls = (
    <div className="flex flex-col gap-1.5">
      <SeekBar
        value={currentTime}
        max={duration}
        buffered={buffered}
        onSeek={seek}
        compact
      />
      <div className="flex items-center gap-1.5">
        <IconButton label="Previous" icon={SkipBack} size="sm" onClick={previous} />
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[#151021] transition hover:brightness-110"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" fill="currentColor" />
          ) : (
            <Play className="h-3.5 w-3.5" fill="currentColor" />
          )}
        </button>
        <IconButton label="Next" icon={SkipForward} size="sm" onClick={() => next()} />
        <span className="player-time ml-1 flex items-center gap-1 whitespace-nowrap text-[10px] tabular-nums text-white/55">
          <span>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          {bufferingIndicator}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <VolumeControl compact />
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Playback speed"
            className="player-speed h-7 rounded-lg border border-white/10 bg-white/6 px-1.5 text-[10px] text-white/80 outline-none"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value} className="bg-[#17131f]">
                {value}×
              </option>
            ))}
          </select>
          <IconButton
            label={showQueue ? "Hide queue" : "Show queue"}
            icon={ListMusic}
            size="sm"
            active={showQueue}
            onClick={() => setShowQueue((visible) => !visible)}
          />
          <IconButton
            label="Expand player"
            icon={Expand}
            size="sm"
            onClick={() => setExpanded(true)}
          />
          <IconButton
            label="Stop playback"
            icon={X}
            size="sm"
            onClick={stopPlayback}
          />
        </div>
      </div>
    </div>
  );

  const iosControls = (
    <div className="space-y-2">
      <div className="relative flex items-center justify-center gap-5 py-0.5">
        <IconButton
          label="Previous"
          icon={SkipBack}
          size="md"
          className="text-white/80 hover:bg-white/10 hover:text-white"
          onClick={previous}
        />
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-[#151021] transition hover:brightness-110"
        >
          {playing ? (
            <Pause className="h-5 w-5" fill="currentColor" />
          ) : (
            <Play className="h-5 w-5" fill="currentColor" />
          )}
        </button>
        <IconButton
          label="Next"
          icon={SkipForward}
          size="md"
          className="text-white/80 hover:bg-white/10 hover:text-white"
          onClick={() => next()}
        />
        <div className="absolute right-0">
          <SpeedButton />
        </div>
      </div>
      <SeekBar
        value={currentTime}
        max={duration}
        buffered={buffered}
        onSeek={seek}
        compact={false}
      />
      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-white/45">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          {bufferingIndicator}
          {transcodeText ? (
            <span className="truncate text-accent">{transcodeText}</span>
          ) : null}
        </span>
        <span className="shrink-0">
          {queue.length} item{queue.length === 1 ? "" : "s"} in this post
        </span>
      </div>
    </div>
  );

  const expandedActions = (
    <>
      <IconButton
        label="Add to playlist"
        icon={Plus}
        size="sm"
        className="text-white/70 hover:bg-white/10 hover:text-white"
        onClick={() =>
          setPlaylistItem({
            service: item.service,
            creatorId: item.creatorId,
            postId: item.postId,
            mediaPath: item.filePath,
            mediaUrl: item.downloadUrl ?? item.url,
            title: item.title,
            creatorName: item.creatorName,
            thumbnailUrl: item.artwork,
            mediaKind: item.mediaKind,
          })
        }
      />
      <IconButton
        label={showQueue ? "Hide queue" : "Show queue"}
        icon={ListMusic}
        size="sm"
        active={showQueue}
        className="text-white/70 hover:bg-white/10 hover:text-white"
        onClick={() => setShowQueue((value) => !value)}
      />
      {!isMobile ? (
        <IconButton
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          icon={fullscreen ? Minimize : Maximize}
          size="sm"
          className="text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => void toggleFullscreen()}
        />
      ) : null}
    </>
  );

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[80] bg-[#0d0f10] text-white animate-fade-in"
          : "player-bar relative z-40 flex shrink-0 items-center gap-3 border-t border-line/70 bg-surface px-4 py-2.5"
      }
    >
      <div
        key="content"
        ref={stageContainerRef}
        className={
          expanded
            ? "absolute inset-0 flex items-center justify-center overflow-hidden bg-black"
            : "flex min-w-0 flex-1 items-center gap-3"
        }
      >
        {mediaStage}

        {expanded ? (
          <>
            <button
              type="button"
              aria-label="Toggle player controls"
              onClick={onVideoClick}
              className="absolute inset-0 z-10 cursor-default"
            />
            {controlsVisible ? (
              <IconButton
                label="Minimize player"
                icon={X}
                size="md"
                className="player-top-close absolute z-30 h-10 w-10 rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/75 hover:text-white"
                onClick={collapse}
              />
            ) : null}
          </>
        ) : null}

        {!expanded ? (
          <div key="panel" className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openOriginalPost}
                title="Open original post"
                className="min-w-0 truncate text-left text-[11px] font-bold text-ink transition hover:text-accent"
              >
                {item.title || item.fileName}
              </button>
              <button
                type="button"
                onClick={openCreator}
                title="Open creator profile"
                className="shrink-0 truncate text-left text-[9px] text-muted transition hover:text-accent"
              >
                {item.creatorName || item.fileName}
              </button>
              <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-muted">
                {isAudio ? "Audio" : "Video"}
              </span>
            </div>
            {transcodeText ? (
              <p className="mt-0.5 text-[9px] font-medium text-accent">
                {transcodeText}
              </p>
            ) : null}
            <div className="mt-1">{controls}</div>
          </div>
        ) : null}
      </div>

      {expanded && controlsVisible ? (
        <div className="player-controls-ios absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent px-4 pt-16">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {item.postId ? (
                <button
                  type="button"
                  onClick={openOriginalPost}
                  title="Open original post"
                  className="block max-w-full truncate text-left text-xs font-bold text-white/90 transition hover:text-accent"
                >
                  {item.title || item.fileName}
                </button>
              ) : (
                <p className="truncate text-xs font-bold text-white/90">
                  {item.title || item.fileName}
                </p>
              )}
              <button
                type="button"
                onClick={openCreator}
                title="Open creator profile"
                className="block max-w-full truncate text-left text-[9px] text-white/40 transition hover:text-accent"
              >
                {item.creatorName || item.fileName}
              </button>
            </div>
            <div className="flex items-center gap-1">{expandedActions}</div>
          </div>
          <div className="mt-2">{iosControls}</div>
        </div>
      ) : null}

      {expanded && showQueue ? <QueuePanel /> : null}
      {!expanded && showQueue ? (
        <CompactQueuePanel onClose={() => setShowQueue(false)} />
      ) : null}

      {playlistItem ? (
        <PlaylistPicker
          open
          item={playlistItem}
          onClose={() => setPlaylistItem(null)}
        />
      ) : null}
    </div>
  );
}
