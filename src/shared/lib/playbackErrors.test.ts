import { describe, expect, it } from "vitest";
import { playbackErrorMessage } from "./playbackErrors";

describe("playback error messages", () => {
  it("explains a removed provider file", () => {
    const message = playbackErrorMessage(
      {
        code: "not_found",
        message: "remote content was not found",
        retryable: false,
      },
      "mega",
    );
    expect(message).toContain("MEGA");
    expect(message).toContain("no longer available");
  });

  it("explains an unavailable provider file", () => {
    const message = playbackErrorMessage(
      {
        code: "unavailable",
        message: "the Proton Drive file no longer exists in this share",
        retryable: true,
      },
      "proton",
    );
    expect(message).toContain("Proton Drive");
    expect(message).toContain("removed");
  });

  it("preserves unrelated errors", () => {
    expect(
      playbackErrorMessage(
        { code: "network", message: "could not connect", retryable: true },
        "gofile",
      ),
    ).toBe("could not connect");
    expect(playbackErrorMessage(new Error("decode failed"), "dropbox")).toBe(
      "decode failed",
    );
  });
});
