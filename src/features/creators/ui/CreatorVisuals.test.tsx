import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { FALLBACK_CONFIG } from "../../../shared/lib/constants";
import { CreatorAvatar } from "./CreatorVisuals";

describe("creator avatar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows initials behind a cached profile image", () => {
    useAppStore.setState({ config: FALLBACK_CONFIG });
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );

    const { container } = render(
      <CreatorAvatar service="patreon" id="42" name="Ada Lovelace" />,
    );

    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveClass("opacity-100");
  });

  it("falls back to initials when the image fails", () => {
    useAppStore.setState({ config: FALLBACK_CONFIG });

    const { container } = render(
      <CreatorAvatar service="patreon" id="42" name="Ada Lovelace" />,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AL")).not.toHaveClass("invisible");
  });
});
