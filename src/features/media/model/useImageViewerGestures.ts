import { useCallback, useRef } from "react";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampPan(
  value: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  const maxX = (window.innerWidth * Math.max(zoom - 1, 0)) / 2;
  const maxY = (window.innerHeight * Math.max(zoom - 1, 0)) / 2;
  return {
    x: clamp(value.x, -maxX, maxX),
    y: clamp(value.y, -maxY, maxY),
  };
}

/**
 * Touch gestures for the image viewer: pinch zoom, pan while zoomed and
 * horizontal swipes between images. Tap suppression prevents the click that
 * follows a drag or pinch from toggling the controls.
 */
export function useImageViewerGestures({
  zoom,
  pan,
  setZoom,
  setPan,
  index,
  imageCount,
  onIndexChange,
  onToggleControls,
}: {
  zoom: number;
  pan: { x: number; y: number };
  setZoom: (zoom: number | ((value: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
  index: number;
  imageCount: number;
  onIndexChange: (index: number) => void;
  onToggleControls: () => void;
}) {
  const touchStart = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const suppressTap = useRef(false);

  const suppressNextTap = useCallback(() => {
    if (suppressTap.current) return;
    suppressTap.current = true;
    window.setTimeout(() => {
      suppressTap.current = false;
    }, 350);
  }, []);

  const onRootClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement | null)?.closest("button")) return;
      if (suppressTap.current) {
        suppressTap.current = false;
        return;
      }
      onToggleControls();
    },
    [onToggleControls],
  );

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      suppressTap.current = false;
      if (event.touches.length === 2) {
        const first = event.touches[0];
        const second = event.touches[1];
        pinchStart.current = {
          distance: Math.hypot(
            first.clientX - second.clientX,
            first.clientY - second.clientY,
          ),
          zoom,
        };
        touchStart.current = null;
        return;
      }
      pinchStart.current = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      touchStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan.x, pan.y, zoom],
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2 && pinchStart.current) {
        const first = event.touches[0];
        const second = event.touches[1];
        const distance = Math.hypot(
          first.clientX - second.clientX,
          first.clientY - second.clientY,
        );
        const nextZoom = clamp(
          pinchStart.current.zoom * (distance / pinchStart.current.distance),
          1,
          5,
        );
        setZoom(nextZoom);
        if (nextZoom <= 1) setPan({ x: 0, y: 0 });
        suppressNextTap();
        return;
      }
      if (event.touches.length === 1 && touchStart.current && zoom > 1) {
        const touch = event.touches[0];
        const dx = touch.clientX - touchStart.current.x;
        const dy = touch.clientY - touchStart.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) suppressNextTap();
        setPan(
          clampPan(
            {
              x: touchStart.current.panX + dx,
              y: touchStart.current.panY + dy,
            },
            zoom,
          ),
        );
      }
    },
    [setPan, setZoom, suppressNextTap, zoom],
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (pinchStart.current && event.touches.length < 2) {
        pinchStart.current = null;
        touchStart.current = null;
        suppressNextTap();
        return;
      }
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || zoom > 1 || imageCount < 2) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 60) return;
      suppressNextTap();
      onIndexChange(
        dx > 0
          ? (index - 1 + imageCount) % imageCount
          : (index + 1) % imageCount,
      );
    },
    [imageCount, index, onIndexChange, suppressNextTap, zoom],
  );

  const onTouchCancel = useCallback(() => {
    touchStart.current = null;
    pinchStart.current = null;
    suppressTap.current = false;
  }, []);

  return {
    onRootClick,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
