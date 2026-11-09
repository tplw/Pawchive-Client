import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { isPlayableMediaKind } from "./queue";
import type { QueueItem } from "../../../shared/types";

interface PlayerStore {
  queue: QueueItem[];
  currentId: string | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  speed: number;
  expanded: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  playItems: (items: QueueItem[], startIndex?: number) => void;
  enqueue: (items: QueueItem[], playNow?: boolean) => void;
  remove: (id: string) => void;
  removeCreator: (service: string, creatorId: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: (automatic?: boolean) => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setSpeed: (speed: number) => void;
  setExpanded: (expanded: boolean) => void;
  setPosition: (time: number, duration: number) => void;
  setDuration: (duration: number) => void;
  setBuffered: (buffered: number) => void;
  setPlaying: (playing: boolean) => void;
  clear: () => void;
}

const memoryStorage: StateStorage = (() => {
  const values = new Map<string, string>();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
})();

function playerStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Private browsing or a restricted webview can deny localStorage.
  }
  return memoryStorage;
}

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
  queue: [],
  currentId: null,
  playing: false,
  volume: 1,
  muted: false,
  speed: 1,
  expanded: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,

  playItems: (items, startIndex = 0) => {
    if (items.length === 0) return;
    const requested = items[Math.min(Math.max(startIndex, 0), items.length - 1)];
    const playable = items.filter((entry) => isPlayableMediaKind(entry.mediaKind));
    if (playable.length === 0) return;
    const requestedIndex = requested
      ? playable.findIndex((entry) => entry.id === requested.id)
      : -1;
    const item = playable[Math.max(requestedIndex, 0)];
    const sameItem = get().currentId === item.id;
    set({
      queue: playable,
      currentId: item.id,
      playing: true,
      ...(sameItem
        ? {}
        : {
            currentTime: 0,
            duration: 0,
            buffered: 0,
          }),
    });
  },

  enqueue: (items, playNow = false) => {
    const playable = items.filter((entry) =>
      isPlayableMediaKind(entry.mediaKind),
    );
    if (playable.length === 0) return;
    const existing = get().queue;
    const byId = new Map(existing.map((item) => [item.id, item]));
    for (const item of playable) byId.set(item.id, item);
    const queue = [...byId.values()];
    const target = playNow || !get().currentId ? playable[0] : null;
    set({
      queue,
      ...(target
        ? {
            currentId: target.id,
            playing: true,
            currentTime: 0,
            duration: 0,
            buffered: 0,
          }
        : {}),
    });
  },

  remove: (id) => {
    const { queue, currentId } = get();
    const index = queue.findIndex((item) => item.id === id);
    const nextQueue = queue.filter((item) => item.id !== id);
    let nextId = currentId;
    if (currentId === id) {
      nextId = nextQueue[Math.min(index, nextQueue.length - 1)]?.id ?? null;
    }
    set({
      queue: nextQueue,
      currentId: nextId,
      playing: nextId ? get().playing : false,
      currentTime: currentId === id ? 0 : get().currentTime,
    });
  },

  move: (id, direction) => {
    const queue = [...get().queue];
    const index = queue.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queue.length) return;
    [queue[index], queue[target]] = [queue[target], queue[index]];
    set({ queue });
  },

  toggle: () => {
    if (!get().currentId) {
      const first = get().queue[0];
      if (first) set({ currentId: first.id, playing: true });
      return;
    }
    set((state) => ({ playing: !state.playing }));
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),

  next: (automatic = false) => {
    const { queue, currentId, duration } = get();
    if (queue.length === 0) return;
    const index = queue.findIndex((item) => item.id === currentId);
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      set({
        playing: false,
        currentTime: automatic ? duration : get().currentTime,
      });
      return;
    }
    const item = queue[nextIndex];
    set({
      currentId: item.id,
      playing: true,
      currentTime: 0,
      duration: 0,
      buffered: 0,
    });
  },

  previous: () => {
    const { queue, currentId, currentTime } = get();
    if (queue.length === 0) return;
    if (currentTime > 3) {
      get().seek(0);
      return;
    }
    const index = queue.findIndex((item) => item.id === currentId);
    const previousIndex = index <= 0 ? queue.length - 1 : index - 1;
    const item = queue[previousIndex];
    set({
      currentId: item.id,
      playing: true,
      currentTime: 0,
      duration: 0,
      buffered: 0,
    });
  },

  seek: (time) => {
    const duration = get().duration;
    const next = Math.min(Math.max(time, 0), duration > 0 ? duration : Math.max(time, 0));
    set({ currentTime: next });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pawchive:seek", { detail: next }));
    }
  },

  setVolume: (volume) => {
    const next = Math.min(Math.max(volume, 0), 1);
    set({ volume: next, muted: next === 0 });
  },

  toggleMute: () => set((state) => ({ muted: !state.muted })),

  setSpeed: (speed) => set({ speed }),

  setExpanded: (expanded) => set({ expanded }),

  setPosition: (currentTime, duration) => {
    set({
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : get().duration,
    });
  },
  setDuration: (duration) =>
    set({ duration: Number.isFinite(duration) && duration > 0 ? duration : 0 }),

  setBuffered: (buffered) => set({ buffered }),

  setPlaying: (playing) => set({ playing }),

  removeCreator: (service, creatorId) =>
    set((state) => {
      const matches = (item: QueueItem) =>
        item.service.toLowerCase() === service.toLowerCase() &&
        item.creatorId.toLowerCase() === creatorId.toLowerCase();
      const queue = state.queue.filter((item) => !matches(item));
      if (queue.length === state.queue.length) return {};
      const currentId = queue.some((item) => item.id === state.currentId)
        ? state.currentId
        : queue[0]?.id ?? null;
      return {
        queue,
        currentId,
        playing: currentId ? state.playing : false,
        currentTime: currentId ? state.currentTime : 0,
        duration: currentId ? state.duration : 0,
        buffered: currentId ? state.buffered : 0,
      };
    }),

      clear: () =>
        set({
          queue: [],
          currentId: null,
          playing: false,
          currentTime: 0,
          duration: 0,
          buffered: 0,
        }),
    }),
    {
      name: "pawchive-player",
      storage: createJSONStorage(playerStorage),
      partialize: (state) => ({
        queue: state.queue,
        currentId: state.currentId,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlayerStore>;
        const savedQueue = Array.isArray(saved.queue) ? saved.queue : [];
        const queue = savedQueue.filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            isPlayableMediaKind(entry.mediaKind),
        );
        const currentId = queue.some((entry) => entry.id === saved.currentId)
          ? saved.currentId ?? null
          : queue[0]?.id ?? null;
        return {
          ...current,
          queue,
          currentId,
          playing: false,
          expanded: false,
          currentTime: 0,
          duration: 0,
          buffered: 0,
        };
      },
    },
  ),
);

export function currentQueueItem(): QueueItem | null {
  const { queue, currentId } = usePlayerStore.getState();
  return queue.find((item) => item.id === currentId) ?? null;
}
