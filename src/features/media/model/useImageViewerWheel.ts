import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { clampPan } from "./useImageViewerGestures";

export function normalizeWheelDelta(delta: number, mode: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * 400;
  return delta;
}

export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

/**
 * Desktop wheel and trackpad support for the image viewer. Ctrl/Cmd + wheel
 * and trackpad pinch zoom around the pointer. A plain wheel zooms in at fit
 * size and pans once the image is zoomed.
 */
export function useImageViewerWheel({
  rootRef,
  zoom,
  setZoom,
  setPan,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
}) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      const dx = normalizeWheelDelta(event.deltaX, event.deltaMode);
      const dy = normalizeWheelDelta(event.deltaY, event.deltaMode);
      if (dx === 0 && dy === 0) return;
      event.preventDefault();

      const currentZoom = zoomRef.current;
      const zoomGesture = event.ctrlKey || event.metaKey;
      if (zoomGesture) {
        const nextZoom = Math.min(
          5,
          Math.max(1, currentZoom * wheelZoomFactor(dy)),
        );
        if (Math.abs(nextZoom - currentZoom) < 0.001) return;
        const rect = node.getBoundingClientRect();
        const cursorX = event.clientX - rect.left - rect.width / 2;
        const cursorY = event.clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / currentZoom;
        setPan((current) =>
          clampPan(
            {
              x: cursorX - (cursorX - current.x) * ratio,
              y: cursorY - (cursorY - current.y) * ratio,
            },
            nextZoom,
          ),
        );
        setZoom(nextZoom);
        return;
      }

      if (currentZoom <= 1) {
        // A wheel or two-finger scroll up starts zooming; scrolling down at
        // fit size does not zoom below the fit.
        if (dy < 0) {
          const nextZoom = Math.min(
            5,
            Math.max(1, currentZoom * wheelZoomFactor(dy)),
          );
          if (nextZoom > 1) setZoom(nextZoom);
        }
        return;
      }

      setPan((current) =>
        clampPan(
          { x: current.x - dx, y: current.y - dy },
          currentZoom,
        ),
      );
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [rootRef, setPan, setZoom]);
}
