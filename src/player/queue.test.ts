import { describe, expect, it } from "vitest";
import { isMegaFileUrl, needsMediaResolution, playbackProgressKey } from "./queue";

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
    expect(
      isMegaFileUrl(
        "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ/file/UQZkxRhB",
      ),
    ).toBe(true);
  });

  it("ignores folders and ordinary media", () => {
    expect(isMegaFileUrl("https://mega.nz/folder/abc#def")).toBe(false);
    expect(isMegaFileUrl("https://cdn.example.com/clip.mp4")).toBe(false);
  });
});

describe("provider resolution", () => {
  it("asks the backend for provider share links", () => {
    expect(
      needsMediaResolution(
        "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
      ),
    ).toBe(true);
    expect(
      needsMediaResolution(
        "https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view",
      ),
    ).toBe(true);
    expect(
      needsMediaResolution("https://www.dropbox.com/scl/fi/abc/clip.mp4?dl=0"),
    ).toBe(true);
    expect(needsMediaResolution("https://gofile.io/d/41qLzaRk")).toBe(true);
  });

  it("leaves direct archive and third-party media alone", () => {
    expect(
      needsMediaResolution("https://file.pawchive.pw/data/aa/clip.mp4"),
    ).toBe(false);
    expect(needsMediaResolution("https://cdn.example.com/clip.mp4")).toBe(false);
  });
});
