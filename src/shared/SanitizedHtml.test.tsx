import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { SanitizedHtml } from "./SanitizedHtml";

vi.mock("./api", () => ({
  api: { openExternal: vi.fn() },
}));

describe("sanitized HTML", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens links externally without navigating the webview", () => {
    render(
      <SanitizedHtml html='<p>Read <a href="https://example.com/post">more</a></p>' />,
    );
    fireEvent.click(screen.getByText("more"));
    expect(api.openExternal).toHaveBeenCalledWith("https://example.com/post");
  });
});
