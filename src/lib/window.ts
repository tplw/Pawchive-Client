import { getCurrentWindow } from "@tauri-apps/api/window";

/** Safe accessor for the Tauri window; returns null in browser/test contexts. */
export function currentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}
