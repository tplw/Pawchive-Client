import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  Music2,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../../../lib/format";
import { usePlayerStore } from "../../../player/store";
import { IconButton } from "../../../components/ui";

export function QueueList({ className }: { className?: string }) {
  const queue = usePlayerStore((state) => state.queue);
  const currentId = usePlayerStore((state) => state.currentId);
  const playItems = usePlayerStore((state) => state.playItems);
  const remove = usePlayerStore((state) => state.remove);
  const move = usePlayerStore((state) => state.move);

  return (
    <div className={cn("overflow-y-auto overscroll-contain p-2", className)}>
      {queue.length === 0 ? (
        <p className="px-3 py-8 text-center text-[11px] text-white/45">
          Add audio or video from a post to start a queue.
        </p>
      ) : (
        queue.map((entry, index) => (
          <div
            key={entry.id}
            className={cn(
              "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition",
              entry.id === currentId ? "bg-accent/15" : "hover:bg-white/8",
            )}
          >
            <button
              type="button"
              onClick={() => playItems(queue, index)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {entry.artwork ? (
                <img src={entry.artwork} alt="" className="h-9 w-9 rounded object-cover" />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded bg-white/8 text-white/50">
                  <Music2 className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-white/90">
                  {entry.title || entry.fileName}
                </span>
                <span className="block truncate text-[9px] text-white/40">
                  {entry.creatorName || entry.fileName}
                </span>
              </span>
            </button>
            <div className="touch-visible flex items-center opacity-0 transition group-hover:opacity-100">
              <IconButton
                label="Move up"
                icon={ChevronUp}
                size="sm"
                className="text-white/50 hover:bg-white/10 hover:text-white"
                disabled={index === 0}
                onClick={() => move(entry.id, -1)}
              />
              <IconButton
                label="Move down"
                icon={ChevronDown}
                size="sm"
                className="text-white/50 hover:bg-white/10 hover:text-white"
                disabled={index === queue.length - 1}
                onClick={() => move(entry.id, 1)}
              />
              <IconButton
                label="Remove from queue"
                icon={X}
                size="sm"
                className="text-white/50 hover:bg-white/10 hover:text-white"
                onClick={() => remove(entry.id)}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function QueuePanel() {
  const queue = usePlayerStore((state) => state.queue);
  const clear = usePlayerStore((state) => state.clear);

  return (
    <aside className="absolute inset-x-0 bottom-0 z-30 mx-auto flex max-h-[62%] w-full max-w-2xl flex-col rounded-t-2xl border-t border-line/70 bg-[#111315]/98 shadow-2xl backdrop-blur-xl">
      <div className="relative flex h-14 shrink-0 items-center gap-2 border-b border-line/60 px-4 pt-2">
        <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
        <ListMusic className="h-4 w-4 text-accent" />
        <span className="text-xs font-bold text-white">Queue</span>
        <span className="rounded border border-line/70 px-1.5 py-0.5 text-[9px] text-white/50">
          {queue.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label="Clear queue"
            icon={Trash2}
            size="sm"
            className="text-white/60 hover:bg-white/10 hover:text-white"
            onClick={clear}
          />
        </div>
      </div>
      <QueueList className="flex-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))]" />
    </aside>
  );
}

export function CompactQueuePanel({ onClose }: { onClose: () => void }) {
  const queue = usePlayerStore((state) => state.queue);
  const clear = usePlayerStore((state) => state.clear);

  return (
    <aside className="absolute bottom-[calc(100%+0.5rem)] right-2 z-50 flex max-h-[min(62vh,32rem)] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-line/70 bg-[#111315]/98 shadow-2xl backdrop-blur-xl animate-slide-up">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line/60 px-3">
        <ListMusic className="h-4 w-4 text-accent" />
        <span className="text-xs font-bold text-white">Queue</span>
        <span className="rounded border border-line/70 px-1.5 py-0.5 text-[9px] text-white/50">
          {queue.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Clear queue"
            icon={Trash2}
            size="sm"
            className="text-white/60 hover:bg-white/10 hover:text-white"
            onClick={clear}
          />
          <IconButton
            label="Close queue"
            icon={X}
            size="sm"
            className="text-white/60 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          />
        </div>
      </div>
      <QueueList className="max-h-[50vh] pb-2" />
    </aside>
  );
}
