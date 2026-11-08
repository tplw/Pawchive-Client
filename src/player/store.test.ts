import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../types";
import { usePlayerStore } from "./store";

function item(id: string, kind: QueueItem["mediaKind"] = "audio"): QueueItem {
  return {
    id,
    url: `https://file.pawchive.pw/data/a/${id}.mp3`,
    filePath: `/a/${id}.mp3`,
    fileName: `${id}.mp3`,
    mediaKind: kind,
    title: `Track ${id}`,
    creatorName: "Ada",
    artwork: null,
    service: "patreon",
    creatorId: "1",
    postId: "2",
  };
}

describe("player queue", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentId: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      expanded: false,
      volume: 1,
      muted: false,
      speed: 1,
    });
  });

  it("starts a queue at the requested item", () => {
    usePlayerStore.getState().playItems([item("a"), item("b")], 1);
    const state = usePlayerStore.getState();
    expect(state.currentId).toBe("b");
    expect(state.playing).toBe(true);
    expect(state.queue).toHaveLength(2);
    expect(state.currentTime).toBe(0);
  });

  it("keeps images out of the player queue", () => {
    usePlayerStore
      .getState()
      .playItems([item("image", "image"), item("a"), item("image-2", "image")], 0);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual([
      "a",
    ]);
    expect(usePlayerStore.getState().currentId).toBe("a");

    usePlayerStore.getState().enqueue([item("image-3", "image")], true);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual([
      "a",
    ]);
  });

  it("removes every queued item from a blocked creator", () => {
    const other = { ...item("c"), creatorId: "2" };
    usePlayerStore.getState().playItems([item("a"), item("b"), other], 0);
    usePlayerStore.getState().removeCreator("patreon", "1");
    const state = usePlayerStore.getState();
    expect(state.queue.map((entry) => entry.id)).toEqual(["c"]);
    expect(state.currentId).toBe("c");
  });

  it("advances to the next item and stops at the end", () => {
    usePlayerStore.getState().playItems([item("a"), item("b")]);
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentId).toBe("b");
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().playing).toBe(false);
    expect(usePlayerStore.getState().currentId).toBe("b");
  });

  it("restarts the current item or goes back", () => {
    usePlayerStore.getState().playItems([item("a"), item("b")], 1);
    usePlayerStore.setState({ currentTime: 20 });
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().currentId).toBe("b");
    expect(usePlayerStore.getState().currentTime).toBe(0);

    usePlayerStore.setState({ currentTime: 0 });
    usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().currentId).toBe("a");
  });

  it("keeps the current position when the same item is played again", () => {
    usePlayerStore.getState().playItems([item("a")], 0);
    usePlayerStore.setState({ currentTime: 42, duration: 100 });
    usePlayerStore.getState().playItems([item("a")], 0);
    expect(usePlayerStore.getState().currentTime).toBe(42);
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it("emits seek events and clamps to the duration", () => {
    const listener = vi.fn();
    window.addEventListener("pawchive:seek", listener);
    usePlayerStore.setState({ duration: 100, currentTime: 0 });
    usePlayerStore.getState().seek(142);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent<number>).detail).toBe(100);
    expect(usePlayerStore.getState().currentTime).toBe(100);
    window.removeEventListener("pawchive:seek", listener);
  });

  it("enqueues, deduplicates, removes and reorders items", () => {
    usePlayerStore.getState().playItems([item("a")]);
    usePlayerStore.getState().enqueue([item("b"), item("a")]);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(["a", "b"]);
    usePlayerStore.getState().move("b", -1);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(["b", "a"]);
    usePlayerStore.getState().remove("b");
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("starts playback when enqueueing into an empty player", () => {
    usePlayerStore.getState().enqueue([item("a")], true);
    expect(usePlayerStore.getState().currentId).toBe("a");
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it("clears the queue and playback state", () => {
    usePlayerStore.getState().playItems([item("a")]);
    usePlayerStore.getState().clear();
    const state = usePlayerStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.currentId).toBeNull();
    expect(state.playing).toBe(false);
  });
});
