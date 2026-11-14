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
