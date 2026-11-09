import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./ui";

describe("Toggle", () => {
  it("toggles from the label row and exposes switch semantics", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Toggle
        checked={false}
        onChange={onChange}
        label="Autoplay next"
        description="Play the next item automatically."
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Autoplay next" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByText("Autoplay next"));
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Toggle
        checked
        onChange={onChange}
        label="Autoplay next"
        description="Play the next item automatically."
      />,
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
