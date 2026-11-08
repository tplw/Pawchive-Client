import { describe, expect, it } from "vitest";
import { isMegaFileUrl, playbackProgressKey } from "./queue";

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

describe("MEGA links", () => {
  it("recognises current and legacy file links", () => {
    expect(
      isMegaFileUrl(
        "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
      ),
    ).toBe(true);
    expect(
      isMegaFileUrl(
        "https://mega.nz/#!Ue5VRSIQ!kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k",
      ),
    ).toBe(true);
  });

  it("ignores folders and ordinary media", () => {
    expect(isMegaFileUrl("https://mega.nz/folder/abc#def")).toBe(false);
    expect(isMegaFileUrl("https://cdn.example.com/clip.mp4")).toBe(false);
  });
});
