import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../services/api";
import { queryKeys } from "../../../shared/query/keys";
type DownloadRequest = Parameters<typeof api.startDownload>[0];

/**
 * Start downloads and refresh the download list consistently. Every entry
 * point (post detail, playlist page, home page) shares the same invalidation.
 */
export function useDownloadActions() {
  const queryClient = useQueryClient();
  const invalidateDownloads = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
  }, [queryClient]);

  const startDownload = useCallback(
    async (request: DownloadRequest) => {
      const record = await api.startDownload(request);
      invalidateDownloads();
      return record;
    },
    [invalidateDownloads],
  );

  const downloadPost = useCallback(
    async (service: string, creatorId: string, postId: string) => {
      const count = await api.downloadPost(service, creatorId, postId);
      invalidateDownloads();
      return count;
    },
    [invalidateDownloads],
  );

  const downloadPlaylist = useCallback(
    async (playlistId: number) => {
      const count = await api.downloadPlaylist(playlistId);
      invalidateDownloads();
      return count;
    },
    [invalidateDownloads],
  );

  return {
    startDownload,
    downloadPost,
    downloadPlaylist,
    invalidateDownloads,
  };
}
