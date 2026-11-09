import type { KeyboardEvent } from "react";

/** Activate a clickable non-button element with Enter or Space. */
export function activate(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
