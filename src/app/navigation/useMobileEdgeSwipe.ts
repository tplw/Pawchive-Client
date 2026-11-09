import { useEffect } from "react";
import { goBack } from "../../shared/lib/router";
import { isMobile } from "../../shared/lib/platform";
import { useAppStore } from "../store";
import { usePlayerStore } from "../../features/player/model/store";

/** Edge swipe back on touch layouts, or close the queue while expanded. */
export function useMobileEdgeSwipe() {
  useEffect(() => {
    if (!isMobile) return;
    let tracking = false;
    let startX = 0;
    let startY = 0;
    let playerExpanded = false;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      const expanded = usePlayerStore.getState().expanded;
      if (!expanded && useAppStore.getState().route.name === "home") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea")) return;
      const touch = event.touches[0];
      if (touch.clientX > 28) return;
      tracking = true;
      playerExpanded = expanded;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx > 72 && dy < 50) {
        tracking = false;
        if (playerExpanded) {
          window.dispatchEvent(new Event("pawchive:close-queue"));
        } else {
          goBack();
        }
      } else if (dx < -10 || dy > 60) {
        tracking = false;
      }
    };
    const onTouchEnd = () => {
      tracking = false;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}
