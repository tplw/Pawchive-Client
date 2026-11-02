import { describe, expect, it } from "vitest";
import { playbackProgressKey } from "./queue";

describe("playback progress key", () => {
  it("uses the archive-relative path for post, playlist and download entries", () => {
    const url = "https://file.pawchive.pw/data/aa/bb/clip.mp4";
    expect(playbackProgressKey({ url, filePath: "aa/bb/clip.mp4" })).toBe(
      "aa/bb/clip.mp4",
    );
    expect(playbackProgressKey({ url, filePath: "/aa/bb/clip.mp4" })).toBe(
      "aa/bb/clip.mp4",
    );
    expect(
      playbackProgressKey({
        url,
        filePath: "/var/mobile/Containers/Data/Application/Downloads/clip.mp4",
      }),
    ).toBe("aa/bb/clip.mp4");
  });

  it("falls back to a normalized local path", () => {
    expect(
      playbackProgressKey({
        url: "not-a-url",
        filePath: "C:\\Users\\Ada\\Downloads\\clip.mp4",
      }),
    ).toBe("C:/Users/Ada/Downloads/clip.mp4");
  });
});
