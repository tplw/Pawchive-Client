import {
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Music2,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api";
import { cn } from "../../../shared/lib/format";
import type { MediaKind } from "../../../shared/types";

/**
 * Thumbnail for downloaded or queued media. Images and known artwork render
 * immediately; videos without artwork fall back to their first frame so a
 * local download still has a useful preview.
 */
export const MediaThumbnail = memo(function MediaThumbnail({
  kind,
  thumbnailUrl,
  mediaUrl,
  localPath,
  className,
  iconClassName,
}: {
  kind: MediaKind;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  localPath?: string | null;
  className?: string;
  iconClassName?: string;
}) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localState, setLocalState] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );
  const [imageIndex, setImageIndex] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [videoFrame, setVideoFrame] = useState<string | null>(null);
  const [videoFrameFailed, setVideoFrameFailed] = useState(false);
  const [videoInView, setVideoInView] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!localPath) {
      setLocalUrl(null);
      setLocalState("idle");
      return;
    }
    setLocalState("loading");
    void api
      .localMediaUrl(localPath)
      .then((url) => {
        if (cancelled) return;
        setLocalUrl(url);
        setLocalState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLocalUrl(null);
        setLocalState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [localPath]);

  const imageSources = [
    ...new Set(
      (kind === "image"
        ? [localUrl, thumbnailUrl, mediaUrl]
        : [thumbnailUrl]
      ).filter((value): value is string => Boolean(value)),
    ),
  ];
  const imageKey = imageSources.join("\n");
  const imageSrc = imageSources[imageIndex] ?? null;
  const videoSrc =
    kind === "video"
      ? localPath
        ? localState === "ready"
          ? localUrl
          : localState === "failed"
            ? mediaUrl
            : null
        : mediaUrl
      : null;
  const canSnapshot = Boolean(localPath && localState === "ready" && localUrl);

  useEffect(() => {
    setImageIndex(0);
    setImageLoaded(false);
  }, [imageKey]);

  useEffect(() => {
    setVideoFrame(null);
    setVideoFrameFailed(false);
    setVideoInView(false);
  }, [videoSrc]);

  useEffect(() => {
    if (!videoSrc || videoFrame || !videoRef.current) return;
    const video = videoRef.current;
    if (typeof IntersectionObserver === "undefined") {
      setVideoInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVideoInView(entries.some((entry) => entry.isIntersecting));
      },
      {
        root: document.getElementById("main-scroll"),
        rootMargin: "320px 0px",
      },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoFrame, videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoInView) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      // Releasing a decoder is best-effort.
    }
  }, [videoInView]);

  const captureVideoFrame = () => {
    const video = videoRef.current;
    if (!video || !canSnapshot || video.videoWidth === 0) return;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 320 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setVideoFrame(canvas.toDataURL("image/jpeg", 0.82));
    } catch {
      // Remote providers may not send CORS headers; keep the video element.
      setVideoFrameFailed(true);
    }
  };

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          "shrink-0 rounded-lg object-cover transition-opacity duration-200",
          imageLoaded ? "opacity-100" : "opacity-0",
          className,
        )}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageIndex((index) => index + 1)}
      />
    );
  }

  if (videoFrame) {
    return (
      <img
        src={videoFrame}
        alt=""
        draggable={false}
        className={cn("shrink-0 rounded-lg object-cover", className)}
      />
    );
  }

  if (kind === "video" && videoSrc) {
    return (
      <video
        ref={videoRef}
        src={videoInView ? `${videoSrc}#t=0.1` : undefined}
        muted
        playsInline
        preload={videoInView ? "metadata" : "none"}
        crossOrigin={canSnapshot && !videoFrameFailed ? "anonymous" : undefined}
        aria-hidden="true"
        tabIndex={-1}
        className={cn(
          "pointer-events-none shrink-0 rounded-lg bg-black object-cover",
          className,
        )}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.duration > 0 && video.currentTime === 0) {
            try {
              video.currentTime = Math.min(0.1, video.duration);
            } catch {
              // Some webviews refuse programmatic seeks before playback.
            }
          }
        }}
        onLoadedData={captureVideoFrame}
        onSeeked={captureVideoFrame}
        onError={() => setVideoFrameFailed(true)}
      />
    );
  }

  const Icon =
    kind === "video"
      ? Film
      : kind === "audio"
        ? Music2
        : kind === "image"
          ? ImageIcon
          : kind === "document"
            ? FileText
            : Download;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-elevated text-muted",
        className,
      )}
    >
      <Icon className={cn("h-5 w-5", iconClassName)} />
    </span>
  );
});
