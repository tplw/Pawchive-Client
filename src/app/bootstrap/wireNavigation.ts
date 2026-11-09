import { setNavigationHandler } from "../../shared/lib/router";
import { useAppStore } from "../store";

/**
 * Connect router helpers to the store at explicit bootstrap time. Keeping this
 * out of the store module avoids import-order side effects.
 */
export function wireNavigation() {
  setNavigationHandler({
    navigate: (route) => useAppStore.getState().navigate(route),
    switchTab: (tab) => useAppStore.getState().switchTab(tab),
    back: (fallback) => useAppStore.getState().back(fallback),
    forward: () => useAppStore.getState().forward(),
  });
}
