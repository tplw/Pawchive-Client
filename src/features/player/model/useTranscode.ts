import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueItem } from "../../../shared/types";
import { errorMessage } from "../../../shared/lib/constants";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";

export type TranscodePhase = "download" | "transcode";

/**
 * Fallback transcode flow for containers the system webview cannot decode.
 * The backend reports download and transcode progress through one event
 * channel; only events belonging to the active request are applied.
 */
export function useTranscode({
  item,
  setSource,
  setLoading,
  setError,
  setPlaying,
}: {
  item: QueueItem | null;
  setSource: (source: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPlaying: (playing: boolean) => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState<TranscodePhase | null>(null);
  const requestRef = useRef<string | null>(null);
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    attemptedRef.current = null;
    setProgress(null);
    setPhase(null);
    return () => {
      const pending = requestRef.current;
      requestRef.current = null;
      if (pending) void api.cancelRequest(pending).catch(() => undefined);
    };
  }, [item?.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{
      requestId?: string;
      phase: string;
      percent?: number | null;
    }>("transcode://progress", (event) => {
      if (event.payload.requestId !== requestRef.current) return;
      setPhase(event.payload.phase === "download" ? "download" : "transcode");
      setProgress(event.payload.percent ?? null);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const startTranscode = useCallback(async () => {
    if (!item) return;
    if (attemptedRef.current === item.id) return;
    attemptedRef.current = item.id;
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    requestRef.current = requestId;
    setError(null);
    setSource(null);
    setLoading(true);
    setPhase("download");
    setProgress(0);
    try {
      const localUrl = await api.transcodeMedia(
        item.downloadUrl ?? item.url,
        requestId,
      );
      if (requestRef.current !== requestId) return;
      requestRef.current = null;
      setSource(localUrl);
      setError(null);
      setLoading(true);
      setPlaying(true);
      setPhase(null);
      setProgress(null);
    } catch (transcodeError) {
      if (requestRef.current !== requestId) return;
      requestRef.current = null;
      const message = errorMessage(transcodeError);
      setError(message);
      setLoading(false);
      setPlaying(false);
      setPhase(null);
      setProgress(null);
      toast("error", "Transcoding failed", message);
    }
  }, [item, setError, setLoading, setPlaying, setSource, toast]);

  const text = phase
    ? `${phase === "download" ? "Downloading" : "Transcoding"}${
        progress !== null ? ` ${Math.round(progress)}%` : "…"
      }`
    : null;

  return { startTranscode, transcodeText: text };
}
