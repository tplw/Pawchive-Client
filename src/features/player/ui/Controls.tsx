import { Volume1, Volume2, VolumeX } from "lucide-react";
import { SPEEDS } from "../../../lib/constants";
import { cn } from "../../../lib/format";
import { usePlayerStore } from "../../../player/store";
import { IconButton } from "../../../components/ui";

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
