import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize,
  Minimize,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentWindow } from "../lib/window";
import { useIsLandscape } from "../lib/orientation";
import { api } from "../services/api";
import { isMobile } from "../lib/platform";
import { useAppStore } from "../stores/app";
import type { Attachment } from "../types";
import { IconButton, lockBodyScroll, unlockBodyScroll } from "./ui";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPan(
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
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const isLandscape = useIsLandscape();
  const cacheMedia = useAppStore((state) => state.settings.cacheMedia);
  const touchStart = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const suppressTap = useRef(false);
  const previousAutoHide = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const image = images[index];
  const autoHideControls = isLandscape && (isMobile || fullscreen);

  const suppressNextTap = () => {
    if (suppressTap.current) return;
    suppressTap.current = true;
    window.setTimeout(() => {
      suppressTap.current = false;
    }, 350);
  };

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

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setProgress(null);
    setDisplaySrc(image.thumbnailUrl ?? null);
    setFailed(false);

    const loadFromNetwork = async () => {
      try {
        const response = await fetch(image.url, {
          signal: controller.signal,
          cache: "force-cache",
        });
        if (!response.ok) {
          if (!cancelled) {
            setDisplaySrc(image.thumbnailUrl ?? image.url);
          }
          return;
        }
        const total = Number(response.headers.get("content-length")) || 0;
        if (!response.body) {
          const blob = await response.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setDisplaySrc(objectUrl);
          return;
        }

        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        if (total > 0) setProgress(0);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          received += value.byteLength;
          if (total > 0 && !cancelled) {
            setProgress(Math.min(99, Math.round((received / total) * 100)));
          }
        }
        if (cancelled) return;
        const blob = new Blob(chunks, {
          type: response.headers.get("content-type") ?? undefined,
        });
        objectUrl = URL.createObjectURL(blob);
        setDisplaySrc(objectUrl);
        setProgress(100);
        window.setTimeout(() => {
          if (!cancelled) setProgress(null);
        }, 250);
      } catch (error) {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setProgress(null);
        setDisplaySrc(image.url);
      }
    };

    let unlisten: (() => void) | undefined;
    let cacheRequestId: string | null = null;
    if (cacheMedia && image.url.startsWith("https://")) {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cacheRequestId = requestId;
      setProgress(0);
      void listen<{
        requestId?: string;
        downloaded: number;
        total?: number | null;
      }>("media-cache://progress", (event) => {
        if (
          cancelled ||
          event.payload.requestId !== requestId ||
          !event.payload.total
        ) {
          return;
        }
        setProgress(
          Math.min(
            99,
            Math.round(
              (event.payload.downloaded / event.payload.total) * 100,
            ),
          ),
        );
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
      void api
        .cacheMedia(image.url, requestId)
        .then((url) => {
          if (cancelled) return;
          setDisplaySrc(url);
          setProgress(100);
          window.setTimeout(() => {
            if (!cancelled) setProgress(null);
          }, 250);
        })
        .catch(() => {
          if (cancelled) return;
          setProgress(null);
          setDisplaySrc(image.url);
        });
    } else {
      void loadFromNetwork();
    }

    return () => {
      cancelled = true;
      controller.abort();
      unlisten?.();
      if (cacheRequestId) {
        void api.cancelRequest(cacheRequestId).catch(() => undefined);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheMedia, image, index]);

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
        onIndexChange((index - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight") {
        onIndexChange((index + 1) % images.length);
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
  }, [fullscreen, images.length, index, onClose, onIndexChange]);

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

  const handleImageError = () => {
    if (image.thumbnailUrl && displaySrc !== image.thumbnailUrl) {
      setDisplaySrc(image.thumbnailUrl);
      return;
    }
    setFailed(true);
  };

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-[90] touch-none overflow-hidden bg-black text-white outline-none animate-fade-in"
      data-modal-open="true"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        if (suppressTap.current) {
          suppressTap.current = false;
          return;
        }
        setControlsVisible((visible) => !visible);
      }}
      onTouchStart={(event) => {
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
      }}
      onTouchMove={(event) => {
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
        if (
          event.touches.length === 1 &&
          touchStart.current &&
          zoom > 1
        ) {
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
      }}
      onTouchEnd={(event) => {
        if (pinchStart.current && event.touches.length < 2) {
          pinchStart.current = null;
          touchStart.current = null;
          suppressNextTap();
          return;
        }
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || zoom > 1 || images.length < 2) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 60 || Math.abs(dy) > 60) return;
        suppressNextTap();
        onIndexChange(
          dx > 0
            ? (index - 1 + images.length) % images.length
            : (index + 1) % images.length,
        );
      }}
      onTouchCancel={() => {
        touchStart.current = null;
        pinchStart.current = null;
        suppressTap.current = false;
      }}
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
