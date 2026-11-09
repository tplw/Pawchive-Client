import { usePlayerStore } from "../../features/player/model/store";
import { goBack, switchTab } from "./router";
import { useAppStore } from "../../app/store";

export type AndroidBackAction = "handled" | "exit";

/**
 * Handle the Android hardware/gesture back button.
 *
 * The app keeps its own per-tab navigation stacks and uses `replaceState`, so
 * the WebView history cannot drive back navigation. Overlays are dismissed
 * first, then the active tab stack, then the app returns to Home. Pressing
 * back at the Home root is left to the caller to close the app.
 */
export function handleAndroidBack(): AndroidBackAction {
  if (document.querySelector('[data-modal-open="true"]')) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return "handled";
  }

  if (usePlayerStore.getState().expanded) {
    window.dispatchEvent(new Event("pawchive:close-queue"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return "handled";
  }

  const state = useAppStore.getState();
  const active = state.tabs[state.activeTab];
  if (active.index > 0) {
    goBack();
    return "handled";
  }

  if (state.activeTab !== "home") {
    switchTab("home");
    return "handled";
  }

  return "exit";
}
