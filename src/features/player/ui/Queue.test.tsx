import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../../../shared/types";
import { usePlayerStore } from "../model/store";
import { CompactQueuePanel, QueuePanel } from "./Queue";

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

function seedQueue() {
  usePlayerStore.setState({
    queue: [item("a"), item("b")],
    currentId: "a",
    playing: true,
    currentTime: 12,
    duration: 100,
    buffered: 40,
  });
}

describe("queue panels", () => {
  beforeEach(seedQueue);

  it("clears the queue and closes the expanded panel", () => {
    const onClose = vi.fn();
    render(<QueuePanel onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Clear queue"));

    expect(usePlayerStore.getState().queue).toEqual([]);
    expect(usePlayerStore.getState().currentId).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears the queue and closes the compact panel", () => {
    const onClose = vi.fn();
    render(<CompactQueuePanel onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Clear queue"));

    expect(usePlayerStore.getState().queue).toEqual([]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
