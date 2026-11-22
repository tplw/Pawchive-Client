import { getCurrentWindow } from "@tauri-apps/api/window";

/** Safe accessor for the Tauri window; returns null in browser/test contexts. */
export function currentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Start a window drag from a custom title-bar region. Interactive controls are
 * excluded so the header can cover the full top strip without swallowing
 * back/forward clicks.
 */
export function startWindowDrag(event: {
  button: number;
  target: EventTarget | null;
}): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("button, a, input, select, textarea, [role='button']")
  ) {
    return;
  }
  const win = currentWindow();
  if (win) void win.startDragging().catch(() => undefined);
}
