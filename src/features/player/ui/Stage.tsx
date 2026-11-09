import { Music2, RotateCcw } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import type { QueueItem } from "../../../types";
import { cn } from "../../../lib/format";
import { Button } from "../../../components/ui";

/**
 * The persistent media stage. It always renders the same `<video>` element so
 * switching queue items does not remount the media element.
 */
export function PlayerStage({
  expanded,
  isAudio,
  item,
  videoRef,
  source,
  error,
  videoReady,
  videoStageStyle,
  onLoadedMetadata,
  onLoadedData,
  onDurationChange,
  onTimeUpdate,
  onProgress,
  onWaiting,
  onStalled,
  onCanPlay,
  onPlaying,
  onPlay,
  onPause,
  onEnded,
  onError,
  onClick,
  onRetry,
}: {
  expanded: boolean;
  isAudio: boolean;
  item: QueueItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  source: string | null;
  error: string | null;
  videoReady: boolean;
  videoStageStyle?: CSSProperties;
  onLoadedMetadata: () => void;
  onLoadedData: () => void;
  onDurationChange: (duration: number) => void;
  onTimeUpdate: () => void;
  onProgress: () => void;
  onWaiting: () => void;
  onStalled: () => void;
  onCanPlay: () => void;
  onPlaying: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onError: () => void;
  onClick: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      role={!expanded ? "button" : undefined}
      tabIndex={!expanded ? 0 : undefined}
      aria-label={
        !expanded
          ? isAudio
            ? "Expand audio player"
            : "Expand video player"
          : undefined
      }
      title={!expanded ? "Expand player" : undefined}
      onClick={!expanded ? onClick : undefined}
      onKeyDown={
        !expanded
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-black",
        expanded
          ? isAudio
            ? "absolute inset-0"
            : "max-h-full max-w-full"
          : isAudio
            ? "h-14 w-14 cursor-pointer rounded-lg"
            : "h-14 w-24 cursor-pointer rounded-lg",
      )}
      style={videoStageStyle}
    >
      {isAudio ? (
        <div className="grid h-full w-full place-items-center overflow-hidden">
          {item.artwork ? (
            <img
              src={item.artwork}
              alt=""
              className={cn(
                "h-full w-full object-cover",
                expanded &&
                  "max-h-[58vh] max-w-[58vh] rounded-2xl object-contain shadow-2xl",
              )}
            />
          ) : (
            <div
              className={cn(
                "grid place-items-center bg-[radial-gradient(circle,rgb(var(--accent)/0.28),transparent_70%)]",
                expanded ? "h-72 w-72 rounded-3xl" : "h-full w-full",
              )}
            >
              <Music2
                className={expanded ? "h-20 w-20 text-accent" : "h-5 w-5 text-accent"}
              />
            </div>
          )}
        </div>
      ) : null}
      <video
        ref={videoRef}
        src={source ?? undefined}
        playsInline
        preload="metadata"
        className={cn(
          "absolute inset-0 h-full w-full object-contain",
          isAudio && "hidden",
        )}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={onLoadedData}
        onDurationChange={() =>
          onDurationChange(videoRef.current?.duration ?? 0)
        }
        onTimeUpdate={onTimeUpdate}
        onProgress={onProgress}
        onWaiting={onWaiting}
        onStalled={onStalled}
        onCanPlay={onCanPlay}
        onPlaying={onPlaying}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onError={onError}
        onClick={onClick}
      />

      {!expanded && !isAudio && item.artwork && !videoReady ? (
        <img
          src={item.artwork}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {error ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-5 text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <p
            className={cn(
              "max-w-sm text-white/75",
              expanded ? "text-xs" : "hidden",
            )}
          >
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
