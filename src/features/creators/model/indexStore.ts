import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import { queryClient } from "../../../shared/lib/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { AppStore, AppStoreApi } from "../../../app/model/types";

/** Refresh the downloaded creator index once a day in the background. */
const CREATOR_INDEX_MAX_AGE_SECS = 24 * 60 * 60;

export function createCreatorIndexActions({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "ensureCreatorIndex"> {
  return {
    ensureCreatorIndex: async (force = false) => {
      if (get().indexState === "syncing") return;
      set({ indexState: "syncing", indexError: null });
      try {
        const status = await api.getCreatorIndexStatus();
        const age = status.syncedAt
          ? Math.floor(Date.now() / 1000) - status.syncedAt
          : Number.POSITIVE_INFINITY;
        const stale = age >= CREATOR_INDEX_MAX_AGE_SECS;
        if (status.count > 0 && !force && !stale) {
          set({ indexState: "ready", indexCount: status.count });
          return;
        }
        const total = await api.syncCreators();
        set({ indexState: "ready", indexCount: total });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.creators() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.creatorAll() }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.creatorSimilarAll(),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.favoritesCreators(),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.postsAll() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.searchAll() }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.creatorPostsAll(),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.postAll() }),
        ]);
      } catch (error) {
        const message = errorMessage(error);
        set({ indexState: "error", indexError: message });
        if (force) {
          get().reportError(error, "Could not refresh the creator index");
        }
      }
    },
  };
}
