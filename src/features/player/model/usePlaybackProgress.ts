import { useCallback, useEffect, type RefObject } from "react";
import type { QueueItem } from "../../../types";
import { api } from "../../../services/api";
import { useAppStore } from "../../../stores/app";
import { usePlayerStore } from "../../../player/store";
import { cachedProgress, rememberProgress } from "../../../player/progress";

/**
 * Save and restore playback positions for the current queue item.
 * Positions are cached in memory, persisted through the backend and refreshed
 * every five seconds while media is playing.
 */
export function usePlaybackProgress({
  item,
  videoRef,
  loadedItemRef,
  progressKey,
  progressKeys,
  resumeRef,
  setPosition,
}: {
  item: QueueItem | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  loadedItemRef: RefObject<string | null>;
  progressKey: string | null;
  progressKeys: string[];
  resumeRef: RefObject<number>;
  setPosition: (current: number, duration: number) => void;
}) {
  const setBuffered = usePlayerStore((state) => state.setBuffered);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    // Read at load time so changing this setting does not restart the current
    // source and lose the playback position.
    const { resumePlayback } = useAppStore.getState().settings;
    if (!resumePlayback || progressKeys.length === 0) return;

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
        if (!video || loadedItemRef.current !== item.id || video.readyState < 1) {
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

    return () => {
      cancelled = true;
    };
  }, [
    item,
    loadedItemRef,
    progressKeys,
    resumeRef,
    setPosition,
    videoRef,
  ]);

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
  }, [item, loadedItemRef, progressKey, videoRef]);

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

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setPosition(video.currentTime, video.duration);
  }, [setPosition, videoRef]);

  const onProgress = useCallback(() => {
    const video = videoRef.current;
    if (video && video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }
  }, [setBuffered, videoRef]);

  return { saveProgress, onTimeUpdate, onProgress };
}
