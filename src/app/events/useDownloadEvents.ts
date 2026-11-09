import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { useAppStore } from "../../stores/app";
import { mergeDownloadProgress } from "../../features/downloads/model/downloadEvents";
import type { DownloadRecord } from "../../types";

/** Patch the cached download list from background download events. */
export function useDownloadEvents() {
  const toast = useAppStore((state) => state.toast);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    void listen<DownloadRecord>("download://progress", (event) => {
      // Progress events fire several times per second per active download.
      // Patch the cached list instead of refetching it on every tick.
      const updated = event.payload;
      if (!updated?.id) return;
      queryClient.setQueryData<DownloadRecord[]>(
        queryKeys.downloads(),
        (records) => mergeDownloadProgress(records, updated),
      );
    }).then((fn) => {
      if (disposed) fn();
      else unlistenProgress = fn;
    });
    void listen<DownloadRecord>("download://complete", () => {
      // Completion is visible in the Downloads page. Avoid one toast per file
      // when a post or playlist queues dozens of downloads.
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlistItems() });
    }).then((fn) => {
      if (disposed) fn();
      else unlistenComplete = fn;
    });
    void listen<DownloadRecord>("download://error", (event) => {
      toast(
        "error",
        "Download failed",
        event.payload.error ?? event.payload.fileName,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
    }).then((fn) => {
      if (disposed) fn();
      else unlistenError = fn;
    });
    return () => {
      disposed = true;
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, [toast]);
}
