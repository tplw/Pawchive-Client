import { api } from "../../services/api";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { setGlobalHideNoMediaDefault } from "../../lib/creatorFilters";
import type { AppStore, AppStoreApi } from "./types";

export function createInitializeAction({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "initialize"> {
  return {
    initialize: async () => {
      try {
        const [settings, config] = await Promise.all([
          api.getSettings(),
          api.getConfig(),
        ]);
        setGlobalHideNoMediaDefault(settings.hideNoMedia);
        set({ settings, config, ready: true });
        void get().ensureCreatorIndex();
        if (settings.autoCheckUpdates) {
          void get().checkForUpdates({ silent: true });
        }
        if (settings.autoSyncFavorites) {
          void (async () => {
            try {
              const account = await api.getAccountState();
              if (!account.loggedIn) return;
              await api.syncAccountFavorites();
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.favoritesCreators(),
                }),
                queryClient.invalidateQueries({
                  queryKey: queryKeys.creators(),
                }),
              ]);
            } catch {
              // Auto-sync is best-effort; the account may be offline/expired.
            }
          })();
        }
      } catch (error) {
        set({ ready: true });
        get().reportError(error, "Could not start Pawchive");
      }
    },
  };
}
