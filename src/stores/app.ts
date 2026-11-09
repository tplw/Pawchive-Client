import { create } from "zustand";
import { DEFAULT_SETTINGS, FALLBACK_CONFIG } from "../lib/constants";
import { setNavigationHandler } from "../lib/router";
import type { AppStore } from "../app/model/types";
import { createInitializeAction } from "../app/model/initialize";
import { createNavigationActions, initialNavigation } from "../app/model/navigation";
import { createToastActions } from "../app/model/toasts";
import { createCreatorIndexActions } from "../features/creators/model/indexStore";
import { createSettingsActions } from "../features/settings/model/store";
import { createUpdateActions } from "../features/updates/model/store";
import { pendingUpdateVersion } from "../features/updates/model/pendingUpdate";

export type {
  IndexState,
  TabStack,
  Toast,
  ToastKind,
} from "../app/model/types";
export { pendingUpdateVersion };

const initial = initialNavigation();

export const useAppStore = create<AppStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  config: FALLBACK_CONFIG,
  route: initial.route,
  previousRoute: initial.previousRoute,
  activeTab: initial.activeTab,
  tabs: initial.tabs,
  ready: false,
  indexState: "idle",
  indexCount: 0,
  indexError: null,
  toasts: [],
  updateInfo: null,
  updateChecking: false,
  updateError: null,
  ...createInitializeAction({ get, set }),
  ...createUpdateActions({ get, set }),
  ...createCreatorIndexActions({ get, set }),
  ...createSettingsActions({ get, set }),
  ...createNavigationActions({ get, set }),
  ...createToastActions({ get, set }),
}));

setNavigationHandler({
  navigate: (route) => useAppStore.getState().navigate(route),
  switchTab: (tab) => useAppStore.getState().switchTab(tab),
  back: (fallback) => useAppStore.getState().back(fallback),
  forward: () => useAppStore.getState().forward(),
});

