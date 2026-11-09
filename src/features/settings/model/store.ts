import { api } from "../../../shared/api";
import {
  applyHideNoMediaToCreators,
  setGlobalHideNoMediaDefault,
} from "../../../shared/lib/creatorFilters";
import type { AppStore, AppStoreApi } from "../../../app/model/types";

let settingsSaveChain: Promise<void> = Promise.resolve();

export function createSettingsActions({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "saveSettings"> {
  return {
    saveSettings: (patch) => {
      const previous = get().settings;
      const next = { ...previous, ...patch };
      if (
        patch.hideNoMedia !== undefined &&
        patch.hideNoMedia !== previous.hideNoMedia
      ) {
        applyHideNoMediaToCreators(patch.hideNoMedia);
      } else {
        setGlobalHideNoMediaDefault(next.hideNoMedia);
      }
      set({ settings: next });
      const run = settingsSaveChain.then(async () => {
        try {
          const saved = await api.saveSettings(next);
          // Ignore stale responses when another setting changed while this
          // request was in flight.
          if (get().settings === next) {
            set({ settings: saved });
            setGlobalHideNoMediaDefault(saved.hideNoMedia);
          }
        } catch (error) {
          if (get().settings !== next) return;
          const persisted = await api.getSettings().catch(() => previous);
          const restored = persisted ?? previous;
          set({ settings: restored });
          setGlobalHideNoMediaDefault(restored.hideNoMedia);
          if (restored.hideNoMedia !== next.hideNoMedia) {
            applyHideNoMediaToCreators(restored.hideNoMedia);
          }
          get().reportError(error, "Could not save settings");
        }
      });
      settingsSaveChain = run.catch(() => undefined);
      return run;
    },
  };
}
