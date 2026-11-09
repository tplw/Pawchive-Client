import { describe, expect, it } from "vitest";
import type { DownloadRecord } from "../../../types";
import { mergeDownloadProgress } from "./downloadEvents";

function record(id: string, downloadedBytes = 0): DownloadRecord {
  return {
    id,
    url: `https://example.com/${id}`,
    filePath: `/tmp/${id}`,
    fileName: id,
    mediaKind: "video",
    title: id,
    creatorName: "Artist",
    service: "patreon",
    creatorId: "creator",
    postId: "post",
    playlistId: null,
    thumbnailUrl: null,
    totalBytes: 100,
    downloadedBytes,
    status: "downloading",
    error: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("download progress merging", () => {
  it("patches an existing record and preserves other fields", () => {
    const current = [record("a", 10), record("b", 20)];
    const result = mergeDownloadProgress(current, {
      ...record("a", 40),
      title: "Updated",
    });
    expect(result?.[0]).toMatchObject({ id: "a", downloadedBytes: 40, title: "Updated" });
    expect(result?.[1]).toMatchObject({ id: "b", downloadedBytes: 20 });
    expect(current[0].downloadedBytes).toBe(10);
  });

  it("prepends unknown records and leaves a missing cache untouched", () => {
    expect(mergeDownloadProgress([], record("new", 5))).toEqual([
      record("new", 5),
    ]);
    expect(mergeDownloadProgress(undefined, record("new", 5))).toBeUndefined();
  });
});
