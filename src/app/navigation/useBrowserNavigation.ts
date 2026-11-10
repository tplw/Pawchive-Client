import { useEffect } from "react";
import { isEditableTarget } from "../../shared/lib/format";
import { goBack, goForward } from "../../shared/lib/router";
import { isMobile } from "../../shared/lib/platform";
import { usePlayerStore } from "../../features/player/model/store";

const SWIPE_THRESHOLD = 52;
const SWIPE_RESET_MS = 180;
const SWIPE_COOLDOWN_MS = 750;

export type HistoryAction = "back" | "forward" | null;

/**
 * Classify a horizontal wheel gesture. A trackpad swipe left-to-right is a
 * back gesture; the opposite direction moves forward. Vertical or diagonal
 * scrolling is ignored.
 */
export function swipeAction(deltaX: number, deltaY: number): HistoryAction {
  if (Math.abs(deltaX) < SWIPE_THRESHOLD) return null;
  if (Math.abs(deltaY) > 24) return null;
  if (Math.abs(deltaX) < Math.abs(deltaY) * 2) return null;
  return deltaX < 0 ? "back" : "forward";
}

function hasHorizontalScroll(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  for (let depth = 0; element && depth < 5; depth += 1) {
    const style = window.getComputedStyle(element);
    if (
      (style.overflowX === "auto" || style.overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth + 4
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function canNavigate(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return false;
  if (document.querySelector('[data-modal-open="true"]')) return false;
  if (hasHorizontalScroll(target)) return false;
  return true;
}

function navigateBack(): void {
  if (document.querySelector('[data-modal-open="true"]')) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return;
  }
  if (usePlayerStore.getState().expanded) {
    usePlayerStore.getState().setExpanded(false);
    return;
  }
  goBack();
}

function navigateForward(): void {
  if (document.querySelector('[data-modal-open="true"]')) return;
  if (usePlayerStore.getState().expanded) return;
  goForward();
}

/**
 * Desktop browser-style history navigation: mouse side buttons, trackpad
 * horizontal swipes and the usual keyboard back/forward shortcuts.
 */
export function useBrowserNavigation() {
  useEffect(() => {
    if (isMobile) return;
    let swipeX = 0;
    let swipeY = 0;
    let lastSwipeAt = -SWIPE_COOLDOWN_MS;
    let resetTimer = 0;

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        if (canNavigate(event.target)) navigateBack();
      } else if (event.button === 4) {
        event.preventDefault();
        if (canNavigate(event.target)) navigateForward();
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!canNavigate(event.target)) return;
      const now = performance.now();
      if (now - lastSwipeAt < SWIPE_COOLDOWN_MS) return;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        swipeX = 0;
        swipeY = 0;
      }, SWIPE_RESET_MS);
      swipeX += event.deltaX;
      swipeY += event.deltaY;
      const action = swipeAction(swipeX, swipeY);
      if (!action) return;
      lastSwipeAt = now;
      swipeX = 0;
      swipeY = 0;
      if (action === "back") navigateBack();
      else navigateForward();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      const historyBack =
        (event.altKey && event.key === "ArrowLeft") ||
        (modifier && event.key === "[");
      const historyForward =
        (event.altKey && event.key === "ArrowRight") ||
        (modifier && event.key === "]");
      if (historyBack) {
        event.preventDefault();
        navigateBack();
      } else if (historyForward) {
        event.preventDefault();
        navigateForward();
      }
    };

    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(resetTimer);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
