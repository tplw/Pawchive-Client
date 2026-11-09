import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import type { AppStore, AppStoreApi } from "../../../app/model/types";
import { pendingUpdateVersion } from "./pendingUpdate";

export function createUpdateActions({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "checkForUpdates" | "dismissUpdate"> {
  return {
    checkForUpdates: async (options) => {
      if (get().updateChecking) return;
      set({ updateChecking: true, updateError: null });
      try {
        const info = await api.checkForUpdate();
        const promptVersion = pendingUpdateVersion(info, get().settings);
        set({ updateInfo: info, updateChecking: false });
        if (info.updateAvailable) {
          // The one-time prompt covers fresh releases. Once the user dismissed
          // this version, only a manual check still reports it as a toast.
          if (!promptVersion && !options?.silent) {
            get().toast(
              "info",
              "Update available",
              `Pawchive ${info.latestVersion} is available.`,
            );
          }
        } else if (!options?.silent) {
          get().toast(
            "success",
            "You're up to date",
            `Pawchive ${info.currentVersion} is the latest version.`,
          );
        }
      } catch (error) {
        set({
          updateChecking: false,
          updateError: errorMessage(error),
        });
        if (!options?.silent) {
          get().reportError(error, "Could not check for updates");
        }
      }
    },

    dismissUpdate: () => {
      const info = get().updateInfo;
      if (!info?.updateAvailable) return Promise.resolve();
      return get().saveSettings({
        dismissedUpdateVersion: info.latestVersion,
      });
    },
  };
}
