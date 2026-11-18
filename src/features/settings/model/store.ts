import { api } from "../../../shared/api";
import {
  applyMediaFilterToCreators,
  effectiveMediaFilter,
  setGlobalMediaFilterDefault,
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
      const previousFilter = effectiveMediaFilter(previous);
      const nextFilter = effectiveMediaFilter(next);
      if (nextFilter !== previousFilter) {
        applyMediaFilterToCreators(nextFilter);
      } else {
        setGlobalMediaFilterDefault(nextFilter);
      }
      set({ settings: next });
      const run = settingsSaveChain.then(async () => {
        try {
          const saved = await api.saveSettings(next);
          // Ignore stale responses when another setting changed while this
          // request was in flight.
          if (get().settings === next) {
            set({ settings: saved });
            setGlobalMediaFilterDefault(effectiveMediaFilter(saved));
          }
        } catch (error) {
          if (get().settings !== next) return;
          const persisted = await api.getSettings().catch(() => previous);
          const restored = persisted ?? previous;
          set({ settings: restored });
          const restoredFilter = effectiveMediaFilter(restored);
          setGlobalMediaFilterDefault(restoredFilter);
          if (restoredFilter !== nextFilter) {
            applyMediaFilterToCreators(restoredFilter);
          }
          get().reportError(error, "Could not save settings");
        }
      });
      settingsSaveChain = run.catch(() => undefined);
      return run;
    },
  };
}
