import { useEffect } from "react";
import { isEditableTarget } from "../../shared/lib/format";
import { switchTab } from "../../shared/lib/router";
import { useAppStore } from "../store";

/** Global search and tab shortcuts. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (useAppStore.getState().route.name === "search") {
          window.dispatchEvent(new CustomEvent("pawchive:focus-search"));
        } else {
          switchTab("search");
          window.setTimeout(
            () =>
              window.dispatchEvent(new CustomEvent("pawchive:focus-search")),
            80,
          );
        }
        return;
      }
      if (!mod || isEditableTarget(event.target)) return;
      const key = event.key;
      if (key === "1") {
        event.preventDefault();
        switchTab("home");
      } else if (key === "2") {
        event.preventDefault();
        switchTab("discover");
      } else if (key === "3") {
        event.preventDefault();
        switchTab("search");
      } else if (key === "4") {
        event.preventDefault();
        switchTab("downloads");
      } else if (key === "5") {
        event.preventDefault();
        switchTab("settings");
      } else if (key === ",") {
        event.preventDefault();
        switchTab("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
