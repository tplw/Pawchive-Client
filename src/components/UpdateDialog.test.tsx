import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/constants";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import { UpdateDialog } from "./UpdateDialog";

vi.mock("../services/api", () => ({
  api: {
    saveSettings: vi.fn(),
    openExternal: vi.fn(),
  },
}));

const info = {
  currentVersion: "1.0.3.1",
  latestVersion: "1.0.4",
  updateAvailable: true,
  url: "https://github.com/tplw/Pawchive-Client/releases/tag/v1.0.4",
  releaseName: "Pawchive 1.0.4",
};

describe("UpdateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
    vi.mocked(api.openExternal).mockResolvedValue(undefined);
    useAppStore.setState({
      updateInfo: info,
      settings: { ...DEFAULT_SETTINGS, dismissedUpdateVersion: "" },
    });
  });

  it("shows once and persists the dismissed version", async () => {
    render(<UpdateDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Pawchive 1.0.4 is ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(useAppStore.getState().settings.dismissedUpdateVersion).toBe(
        "1.0.4",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the release and dismisses the prompt", async () => {
    render(<UpdateDialog />);
    fireEvent.click(
      screen.getByRole("button", { name: "Get version 1.0.4" }),
    );

    expect(api.openExternal).toHaveBeenCalledWith(info.url);
    await waitFor(() =>
      expect(useAppStore.getState().settings.dismissedUpdateVersion).toBe(
        "1.0.4",
      ),
    );
  });

  it("stays hidden for a dismissed version, but returns for a newer one", () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, dismissedUpdateVersion: "1.0.4" },
    });
    const { rerender } = render(<UpdateDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    useAppStore.setState({
      updateInfo: { ...info, latestVersion: "1.0.4.1" },
    });
    rerender(<UpdateDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
