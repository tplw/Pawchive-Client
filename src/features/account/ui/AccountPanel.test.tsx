import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../shared/api";
import { AccountPanel } from "./AccountPanel";

vi.mock("../../../shared/api", () => ({
  api: {
    getAccountState: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    syncAccountFavorites: vi.fn(),
  },
}));

function wrapper(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("account page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the login form when signed out", async () => {
    vi.mocked(api.getAccountState).mockResolvedValue({
      loggedIn: false,
      username: null,
    });
    wrapper(<AccountPanel />);
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows the signed-in account", async () => {
    vi.mocked(api.getAccountState).mockResolvedValue({
      loggedIn: true,
      username: "ada",
    });
    wrapper(<AccountPanel />);
    expect(await screen.findByText("ada")).toBeInTheDocument();
    expect(screen.getByText("Sync favorite creators")).toBeInTheDocument();
  });
});
