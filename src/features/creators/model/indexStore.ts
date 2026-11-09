import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import { queryClient } from "../../../shared/lib/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { AppStore, AppStoreApi } from "../../../app/model/types";

export function createCreatorIndexActions({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "ensureCreatorIndex"> {
  return {
    ensureCreatorIndex: async (force = false) => {
      if (get().indexState === "syncing") return;
      set({ indexState: "syncing", indexError: null });
      try {
        const existing = await api.getCreatorCount();
        if (existing > 0 && !force) {
          set({ indexState: "ready", indexCount: existing });
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
