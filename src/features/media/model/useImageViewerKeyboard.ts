import { useEffect, type RefObject } from "react";
import { currentWindow } from "../../../lib/window";

/** Keyboard navigation, zoom shortcuts and the focus trap for the viewer. */
export function useImageViewerKeyboard({
  rootRef,
  fullscreen,
  setFullscreen,
  index,
  imageCount,
  onIndexChange,
  onClose,
  setZoom,
  setPan,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
  index: number;
  imageCount: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  setZoom: (zoom: number | ((value: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const root = rootRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            element.offsetParent !== null || element === document.activeElement,
        );
        if (focusable.length === 0) {
          event.preventDefault();
          root.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !root.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (active === last || !root.contains(active))
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        if (fullscreen) {
          const win = currentWindow();
          if (win) {
            void win
              .setFullscreen(false)
              .then(() => setFullscreen(false))
              .catch(() => undefined);
          }
        } else {
          onClose();
        }
      } else if (event.key === "ArrowLeft") {
        onIndexChange((index - 1 + imageCount) % imageCount);
      } else if (event.key === "ArrowRight") {
        onIndexChange((index + 1) % imageCount);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((value) => Math.min(value + 0.25, 5));
      } else if (event.key === "-") {
        setZoom((value) => Math.max(value - 0.25, 1));
      } else if (event.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    fullscreen,
    imageCount,
    index,
    onClose,
    onIndexChange,
    rootRef,
    setFullscreen,
    setPan,
    setZoom,
  ]);
}
