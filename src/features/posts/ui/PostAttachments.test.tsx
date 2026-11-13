import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../shared/types";
import { PostAttachments } from "./PostAttachments";

const locked: Attachment = {
  name: "MEGA password-protected link",
  path: "https://mega.nz/#P!protected",
  url: "https://mega.nz/#P!protected",
  downloadUrl: "https://mega.nz/#P!protected",
  thumbnailUrl: null,
  kind: "other",
  provider: "mega",
  ext: "",
  previewOnly: false,
  locked: true,
};

function renderAttachments(onUnlock: (attachment: Attachment) => void) {
  return render(
    <PostAttachments
      count={1}
      images={[]}
      playable={[]}
      documents={[locked]}
      disabled={false}
      onViewImage={() => undefined}
      onPlay={() => undefined}
      onQueue={() => undefined}
      onAddToPlaylist={() => undefined}
      onDownload={() => undefined}
      onOpenFile={() => undefined}
      onUnlock={onUnlock}
    />,
  );
}

describe("locked post attachments", () => {
  it("shows a lock action instead of playback actions", () => {
    const onUnlock = vi.fn();
    renderAttachments(onUnlock);
    expect(screen.getByText("password protected")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Unlock link"));
    expect(onUnlock).toHaveBeenCalledWith(locked);
  });

  it("shows a loading state while provider metadata is resolving", () => {
    const onUnlock = vi.fn();
    render(
      <PostAttachments
        count={1}
        images={[]}
        playable={[]}
        documents={[{ ...locked, locked: false, resolving: true }]}
        disabled={false}
        onViewImage={() => undefined}
        onPlay={() => undefined}
        onQueue={() => undefined}
        onAddToPlaylist={() => undefined}
        onDownload={() => undefined}
        onOpenFile={() => undefined}
        onUnlock={onUnlock}
      />,
    );
    expect(screen.getByText("loading provider info…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Download")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unlock link")).not.toBeInTheDocument();
    expect(
      screen.getByText("loading provider info…").closest("[aria-busy]"),
    ).toHaveAttribute("aria-busy", "true");
  });
});
