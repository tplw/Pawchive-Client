import { useEffect } from "react";
import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { isAndroid } from "../../lib/platform";
import { handleAndroidBack } from "../../lib/backNavigation";

/** Route Android hardware back through the in-app back stack. */
export function useAndroidBack() {
  useEffect(() => {
    if (!isAndroid) return;
    let disposed = false;
    let unregister: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (handleAndroidBack() === "exit") void exit(0);
    })
      .then((listener) => {
        if (disposed) void listener.unregister();
        else unregister = () => void listener.unregister();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unregister?.();
    };
  }, []);
}
