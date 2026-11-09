import {
  Expand,
  ListMusic,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { SPEEDS } from "../../../shared/lib/constants";
import { cn, formatDuration } from "../../../shared/lib/format";
import { isMobile } from "../../../shared/lib/platform";
import { usePlayerStore } from "../model/store";
import { IconButton } from "../../../shared/ui";

export function SeekBar({
  value,
  max,
  buffered,
  onSeek,
  compact,
}: {
  value: number;
  max: number;
  buffered: number;
  onSeek: (value: number) => void;
  compact: boolean;
}) {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const bufferedPercent = max > 0 ? Math.min((buffered / max) * 100, 100) : 0;
  return (
    <div className={cn("relative flex items-center", compact ? "h-3" : "h-5")}>
      <div className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/12">
        <div className="h-full bg-white/20" style={{ width: `${bufferedPercent}%` }} />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(max, 0.01)}
        step={0.1}
        value={Math.min(value, max || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Seek"
        className="seek-range relative z-10 w-full"
      />
    </div>
  );
}

export function VolumeControl({ compact }: { compact: boolean }) {
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.55 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        icon={Icon}
        size="sm"
        onClick={toggleMute}
      />
      {!compact ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
          className="volume-range w-20"
        />
      ) : null}
    </div>
  );
}

export function SpeedButton() {
  const speed = usePlayerStore((state) => state.speed);
  const setSpeed = usePlayerStore((state) => state.setSpeed);
  const cycle = () => {
    const index = SPEEDS.findIndex((value) => value === speed);
    const next = SPEEDS[(index + 1) % SPEEDS.length];
    setSpeed(next);
  };
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Playback speed ${speed}×`}
      title="Change playback speed"
      className="h-8 min-w-[3.25rem] rounded-lg border border-white/10 bg-white/6 px-2 text-[11px] font-medium text-white/80 transition hover:bg-white/12 hover:text-white"
    >
      {speed}×
    </button>
  );
}

function BufferingIndicator({
  loading,
  error,
}: {
  loading: boolean;
  error: string | null;
}) {
  if (!loading || error) return null;
  return (
    <span
      role="status"
      aria-label="Buffering"
      className="inline-flex shrink-0 items-center"
    >
      <LoaderCircle className="h-3 w-3 animate-spin text-white/60" />
    </span>
  );
}

export function CompactControls({
  currentTime,
  duration,
  buffered,
  onSeek,
  playing,
  onTogglePlayback,
  onPrevious,
  onNext,
  loading,
  error,
  speed,
  onSpeedChange,
  showQueue,
  onToggleQueue,
  onExpand,
  onStop,
}: {
  currentTime: number;
  duration: number;
  buffered: number;
  onSeek: (value: number) => void;
  playing: boolean;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
  speed: number;
  onSpeedChange: (speed: number) => void;
  showQueue: boolean;
  onToggleQueue: () => void;
  onExpand: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SeekBar
        value={currentTime}
        max={duration}
        buffered={buffered}
        onSeek={onSeek}
        compact
      />
      <div className="flex items-center gap-1.5">
        <IconButton
          label="Previous"
          icon={SkipBack}
          size="sm"
          onClick={onPrevious}
        />
        <button
          type="button"
          onClick={onTogglePlayback}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[#151021] transition hover:brightness-110"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" fill="currentColor" />
          ) : (
            <Play className="h-3.5 w-3.5" fill="currentColor" />
          )}
        </button>
        <IconButton
          label="Next"
          icon={SkipForward}
          size="sm"
          onClick={onNext}
        />
        <span className="player-time ml-1 flex items-center gap-1 whitespace-nowrap text-[10px] tabular-nums text-white/55">
          <span>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <BufferingIndicator loading={loading} error={error} />
        </span>
        <div className="ml-auto flex items-center gap-1">
          <VolumeControl compact />
          <select
            value={speed}
            onChange={(event) => onSpeedChange(Number(event.target.value))}
            aria-label="Playback speed"
            className="player-speed h-7 rounded-lg border border-white/10 bg-white/6 px-1.5 text-[10px] text-white/80 outline-none"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value} className="bg-[#17131f]">
                {value}×
              </option>
            ))}
          </select>
          <IconButton
            label={showQueue ? "Hide queue" : "Show queue"}
            icon={ListMusic}
            size="sm"
            active={showQueue}
            onClick={onToggleQueue}
          />
          <IconButton
            label="Expand player"
            icon={Expand}
            size="sm"
            onClick={onExpand}
          />
          <IconButton
            label="Stop playback"
            icon={X}
            size="sm"
            onClick={onStop}
          />
        </div>
      </div>
    </div>
  );
}

export function ExpandedControls({
  item,
  playing,
  currentTime,
  duration,
  buffered,
  onSeek,
  onPrevious,
  onNext,
  onTogglePlayback,
  loading,
  error,
  transcodeText,
  queueLength,
  showQueue,
  onToggleQueue,
  onAddToPlaylist,
  fullscreen,
  onToggleFullscreen,
  onOpenPost,
  onOpenCreator,
}: {
  item: {
    title: string;
    fileName: string;
    creatorName: string;
    postId: string;
  };
  playing: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  onSeek: (value: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayback: () => void;
  loading: boolean;
  error: string | null;
  transcodeText: string | null;
  queueLength: number;
  showQueue: boolean;
  onToggleQueue: () => void;
  onAddToPlaylist: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenPost: () => void;
  onOpenCreator: () => void;
}) {
  return (
    <div className="player-controls-ios absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent px-4 pt-16">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {item.postId ? (
            <button
              type="button"
              onClick={onOpenPost}
              title="Open original post"
              className="block max-w-full truncate text-left text-xs font-bold text-white/90 transition hover:text-accent"
            >
              {item.title || item.fileName}
            </button>
          ) : (
            <p className="truncate text-xs font-bold text-white/90">
              {item.title || item.fileName}
            </p>
          )}
          <button
            type="button"
            onClick={onOpenCreator}
            title="Open creator profile"
            className="block max-w-full truncate text-left text-[9px] text-white/40 transition hover:text-accent"
          >
            {item.creatorName || item.fileName}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label="Add to playlist"
            icon={Plus}
            size="sm"
            className="text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onAddToPlaylist}
          />
          <IconButton
            label={showQueue ? "Hide queue" : "Show queue"}
            icon={ListMusic}
            size="sm"
            active={showQueue}
            className="text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onToggleQueue}
          />
          {!isMobile ? (
            <IconButton
              label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              icon={fullscreen ? Minimize : Maximize}
              size="sm"
              className="text-white/70 hover:bg-white/10 hover:text-white"
              onClick={onToggleFullscreen}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        <div className="relative flex items-center justify-center gap-5 py-0.5">
          <IconButton
            label="Previous"
            icon={SkipBack}
            size="md"
            className="text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onPrevious}
          />
          <button
            type="button"
            onClick={onTogglePlayback}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-[#151021] transition hover:brightness-110"
          >
            {playing ? (
              <Pause className="h-5 w-5" fill="currentColor" />
            ) : (
              <Play className="h-5 w-5" fill="currentColor" />
            )}
          </button>
          <IconButton
            label="Next"
            icon={SkipForward}
            size="md"
            className="text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onNext}
          />
          <div className="absolute right-0">
            <SpeedButton />
          </div>
        </div>
        <SeekBar
          value={currentTime}
          max={duration}
          buffered={buffered}
          onSeek={onSeek}
          compact={false}
        />
        <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-white/45">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
            <BufferingIndicator loading={loading} error={error} />
            {transcodeText ? (
              <span className="truncate text-accent">{transcodeText}</span>
            ) : null}
          </span>
          <span className="shrink-0">
            {queueLength} item{queueLength === 1 ? "" : "s"} in this post
          </span>
        </div>
      </div>
    </div>
  );
}
