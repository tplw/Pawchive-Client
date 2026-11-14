import { beforeEach, describe, expect, it } from "vitest";
import type { QueueItem } from "../../../shared/types";
import { usePlayerStore } from "./store";

function item(id: string): QueueItem {
  return {
    id,
    url: `https://file.pawchive.pw/data/a/${id}.mp3`,
    filePath: `/a/${id}.mp3`,
    fileName: `${id}.mp3`,
    mediaKind: "audio",
    title: `Track ${id}`,
    creatorName: "Ada",
    artwork: null,
    service: "patreon",
    creatorId: "1",
    postId: "2",
  };
}

describe("single-item playback", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentId: null,
      playing: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
    });
  });

  it("keeps the current position when the same item is played again", () => {
    usePlayerStore.getState().playItems([item("a")]);
    usePlayerStore.setState({ currentTime: 42, duration: 100, buffered: 60 });

    usePlayerStore.getState().enqueue([item("a")], true);

    expect(usePlayerStore.getState()).toMatchObject({
      currentId: "a",
      playing: true,
      currentTime: 42,
      duration: 100,
      buffered: 60,
    });
  });
});
