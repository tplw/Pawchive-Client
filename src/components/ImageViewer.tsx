import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize,
  Minimize,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentWindow } from "../lib/window";
import { useIsLandscape } from "../lib/orientation";
import { isMobile } from "../lib/platform";
import { useAppStore } from "../stores/app";
import type { Attachment } from "../types";
import { IconButton, lockBodyScroll, unlockBodyScroll } from "./ui";
import { useImageViewerSource } from "../features/media/model/useImageViewerSource";
import { useImageViewerGestures } from "../features/media/model/useImageViewerGestures";
import { useImageViewerKeyboard } from "../features/media/model/useImageViewerKeyboard";

export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: Attachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const isLandscape = useIsLandscape();
  const cacheMedia = useAppStore((state) => state.settings.cacheMedia);
  const previousAutoHide = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const image = images[index];
  const autoHideControls = isLandscape && (isMobile || fullscreen);
  const { displaySrc, progress, failed, handleImageError } =
    useImageViewerSource({ image, index, cacheMedia });
  const gestures = useImageViewerGestures({
    zoom,
    pan,
    setZoom,
    setPan,
    index,
    imageCount: images.length,
    onIndexChange,
    onToggleControls: () => setControlsVisible((visible) => !visible),
  });
  useImageViewerKeyboard({
    rootRef,
    fullscreen,
    setFullscreen,
    index,
    imageCount: images.length,
    onIndexChange,
    onClose,
    setZoom,
    setPan,
  });

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index, image?.url]);

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  useEffect(() => {
    if (previousAutoHide.current && !autoHideControls) {
      setControlsVisible(true);
    }
    previousAutoHide.current = autoHideControls;
  }, [autoHideControls]);

  useEffect(() => {
    if (!autoHideControls || !controlsVisible) return;
    const timer = window.setTimeout(() => setControlsVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [autoHideControls, controlsVisible, index, zoom]);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    lockBodyScroll();
    const timer = window.setTimeout(() => rootRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      unlockBodyScroll();
      const target = previousFocus.current;
      if (target?.isConnected) {
        window.setTimeout(() => target.focus(), 0);
      }
    };
  }, []);

  useEffect(() => {
    const win = currentWindow();
    if (!win) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win.isFullscreen().then(setFullscreen).catch(() => undefined);
    };
    sync();
    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleFullscreen = async () => {
    const win = currentWindow();
    if (!win) return;
    try {
      const current = await win.isFullscreen().catch(() => fullscreen);
      const next = !current;
      await win.setFullscreen(next);
      setFullscreen(next);
    } catch {
      // Fullscreen is an enhancement; the overlay still covers the window.
    }
  };

  const close = () => {
    if (fullscreen) {
      const win = currentWindow();
      if (win) void win.setFullscreen(false).catch(() => undefined);
    }
    onClose();
  };

  if (!image) return null;

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-[90] touch-none overflow-hidden bg-black text-white outline-none animate-fade-in"
      data-modal-open="true"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={gestures.onRootClick}
      onTouchStart={gestures.onTouchStart}
      onTouchMove={gestures.onTouchMove}
      onTouchEnd={gestures.onTouchEnd}
      onTouchCancel={gestures.onTouchCancel}
    >
      {displaySrc && !failed ? (
        <img
          src={displaySrc}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
          draggable={false}
        />
      ) : null}

      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        {displaySrc && !failed ? (
          <img
            src={displaySrc}
            alt={image.name}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            }}
            draggable={false}
            onError={handleImageError}
          />
        ) : failed ? (
          <div className="px-6 text-center">
            <p className="text-sm font-medium text-white/80">
              This image could not be loaded
            </p>
            <p className="mt-1 text-xs text-white/45">{image.name}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/60">
            <LoaderCircle className="h-6 w-6 animate-spin" />
            <span className="text-[10px]">Fetching image…</span>
          </div>
        )}
      </div>

      {controlsVisible ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-xs font-medium text-white/90">
                {image.name}
              </p>
              {progress !== null ? (
                <span className="shrink-0 text-[10px] tabular-nums text-white/55">
                  {progress}%
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-white/40">
              {index + 1} / {images.length}
              {zoom > 1 ? ` · ${Math.round(zoom * 100)}%` : ""}
            </p>
          </div>
          <div className="pointer-events-auto flex items-center gap-1">
            {!isMobile ? (
              <IconButton
                label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                icon={fullscreen ? Minimize : Maximize}
                size="sm"
                className="text-white/75 hover:bg-white/10 hover:text-white"
                onClick={() => void toggleFullscreen()}
              />
            ) : null}
            <IconButton
              label="Close viewer"
              icon={X}
              size="sm"
              className="text-white/75 hover:bg-white/10 hover:text-white"
              onClick={close}
            />
          </div>
        </div>
      ) : null}

      {controlsVisible && images.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={() =>
              onIndexChange((index - 1 + images.length) % images.length)
            }
            className="absolute left-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur transition hover:bg-black/65 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={() => onIndexChange((index + 1) % images.length)}
            className="absolute right-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur transition hover:bg-black/65 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
