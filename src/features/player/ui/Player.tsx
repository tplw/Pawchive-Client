import { Music2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentWindow } from "../../../shared/lib/window";
import { api } from "../../../shared/api";
import { useIsLandscape } from "../../../shared/lib/orientation";
import { isIos, isMobile } from "../../../shared/lib/platform";
import { navigate } from "../../../shared/lib/router";
import { useAppStore } from "../../../app/store";
import {
  isMegaFileUrl,
  isPlayableMediaKind,
  playbackProgressKey,
} from "../model/queue";
import { usePlayerStore } from "../model/store";
import type { PlaylistItemInput } from "../../../shared/types";

import { Button, IconButton } from "../../../shared/ui";
import { PlaylistPicker } from "../../playlists/ui/PlaylistPicker";
import {
  CompactControls,
  ExpandedControls,
} from "./Controls";
import { CompactQueuePanel, QueuePanel } from "./Queue";
import { PlayerStage } from "./Stage";
import { useMediaSession } from "../model/useMediaSession";
import { usePlayerKeyboard } from "../model/usePlayerKeyboard";
import { useSeekEvent } from "../model/useSeekEvent";
import { useFullscreen } from "../model/useFullscreen";
import {
  isHlsUrl,
  useMediaSource,
} from "../model/useMediaSource";
import { usePlaybackProgress } from "../model/usePlaybackProgress";
import { useTranscode } from "../model/useTranscode";

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
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showQueue, setShowQueue] = useState(false);
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
  const setSpeed = usePlayerStore((state) => state.setSpeed);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const seek = usePlayerStore((state) => state.seek);
  const clear = usePlayerStore((state) => state.clear);

  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
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
  const { fullscreen, setFullscreen, toggleFullscreen } = useFullscreen();
  const { startTranscode, resetTranscode, transcodeText } = useTranscode({
    item,
    setSource,
    setLoading,
    setError,
    setPlaying,
  });
  const { onLoadedMetadata, onError, retry } = useMediaSource({
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
  });
  const { saveProgress, onTimeUpdate, onProgress } = usePlaybackProgress({
    item,
    videoRef,
    loadedItemRef,
    progressKey,
    progressKeys,
    resumeRef,
    setPosition,
  });
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
    const closeQueue = () => setShowQueue(false);
    window.addEventListener("pawchive:close-queue", closeQueue);
    window.addEventListener("hashchange", closeQueue);
    return () => {
      window.removeEventListener("pawchive:close-queue", closeQueue);
      window.removeEventListener("hashchange", closeQueue);
    };
  }, []);

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

  useMediaSession(item);

  useSeekEvent(videoRef);

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
  }, [fullscreen, saveProgress, setExpanded, setFullscreen]);

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
    <PlayerStage
      expanded={expanded}
      isAudio={isAudio}
      item={item}
      videoRef={videoRef}
      source={source}
      error={error}
      videoReady={videoReady}
      videoStageStyle={videoStageStyle}
      onLoadedMetadata={onLoadedMetadata}
      onLoadedData={() => setVideoReady(true)}
      onDurationChange={setDuration}
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
        const index = state.queue.findIndex(
          (entry) => entry.id === state.currentId,
        );
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
      onRetry={() => {
        resetTranscode();
        retry();
      }}
    />
  );

  const openPlaylistPicker = () =>
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
    });

  const controls = (
    <CompactControls
      currentTime={currentTime}
      duration={duration}
      buffered={buffered}
      onSeek={seek}
      playing={playing}
      onTogglePlayback={togglePlayback}
      onPrevious={previous}
      onNext={() => next()}
      loading={loading}
      error={error}
      speed={speed}
      onSpeedChange={setSpeed}
      showQueue={showQueue}
      onToggleQueue={() => setShowQueue((visible) => !visible)}
      onExpand={() => setExpanded(true)}
      onStop={stopPlayback}
    />
  );

  const expandedControls = (
    <ExpandedControls
      item={item}
      playing={playing}
      currentTime={currentTime}
      duration={duration}
      buffered={buffered}
      onSeek={seek}
      onPrevious={previous}
      onNext={() => next()}
      onTogglePlayback={togglePlayback}
      loading={loading}
      error={error}
      transcodeText={transcodeText}
      queueLength={queue.length}
      showQueue={showQueue}
      onToggleQueue={() => setShowQueue((value) => !value)}
      onAddToPlaylist={openPlaylistPicker}
      fullscreen={fullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
      onOpenPost={openOriginalPost}
      onOpenCreator={openCreator}
    />
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

      {expanded && controlsVisible ? expandedControls : null}

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
