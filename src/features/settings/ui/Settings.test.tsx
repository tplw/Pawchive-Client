import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { DEFAULT_SETTINGS } from "../../../shared/lib/constants";
import { useAppStore } from "../../../app/store";
import { SettingsPage } from "./Settings";

vi.mock("../../../shared/api", () => ({
  api: {
    canTranscode: vi.fn(),
    getAccountState: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    syncAccountFavorites: vi.fn(),
    clearMediaCache: vi.fn(),
    openDownloadsFolder: vi.fn(),
    openExternal: vi.fn(),
  },
}));

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings: DEFAULT_SETTINGS,
      toasts: [],
    });
    vi.mocked(api.canTranscode).mockResolvedValue(false);
    vi.mocked(api.getAccountState).mockResolvedValue({
      loggedIn: false,
      username: null,
    });
    vi.mocked(api.getSettings).mockResolvedValue(DEFAULT_SETTINGS);
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => settings);
  });

  it("saves the tag visibility toggles", async () => {
    wrapper(<SettingsPage />);

    fireEvent.click(
      await screen.findByRole("switch", { name: "Hide file tags" }),
    );
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ hideFileTags: true }),
      ),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Hide source tags" }));
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ hideSourceTags: true }),
      ),
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Hide post play buttons" }),
    );
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ hidePostPlayButton: true }),
      ),
    );
  });

  it("uses collapsible cards for updates and blocked creators", () => {
    wrapper(<SettingsPage />);

    const updates = screen.getByText("Updates").closest("details");
    const blocked = screen.getByText("Blocked creators").closest("details");
    expect(updates).toBeInTheDocument();
    expect(blocked).toBeInTheDocument();
    expect(updates).not.toHaveAttribute("open");
    expect(blocked).not.toHaveAttribute("open");
  });

  it("saves the comic image options", async () => {
    wrapper(<SettingsPage />);

    fireEvent.change(await screen.findByDisplayValue("All images"), {
      target: { value: "first" },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ comicFirstImageOnly: true }),
      ),
    );

    fireEvent.change(screen.getByDisplayValue("Off"), {
      target: { value: "2" },
    });
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ comicPrefetchCount: 2 }),
      ),
    );
  });

  it("saves the post media filter", async () => {
    wrapper(<SettingsPage />);

    fireEvent.change(
      await screen.findByDisplayValue("All posts"),
      { target: { value: "filesOnly" } },
    );

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaFilter: "filesOnly",
          hideNoMedia: false,
        }),
      ),
    );
  });

  it("saves hidden keywords when Settings closes before the debounce", async () => {
    const { unmount } = wrapper(<SettingsPage />);
    const textarea = await screen.findByPlaceholderText(
      "spoiler, commission, teaser",
    );

    fireEvent.change(textarea, { target: { value: "spoiler" } });
    unmount();

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ hiddenKeywords: ["spoiler"] }),
      ),
    );
  });
});
