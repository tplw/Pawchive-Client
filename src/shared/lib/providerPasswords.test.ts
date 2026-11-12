import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveProviderPassword,
  subscribeProviderPassword,
  withProviderPassword,
  type ProviderPasswordRequest,
} from "./providerPasswords";

vi.mock("../api", () => ({
  api: {
    setProviderPassword: vi.fn(),
  },
}));

import { api } from "../api";

function passwordError(url: string, provider = "MEGA", rejected = false) {
  return {
    code: "password_required",
    message: `a password is required for this ${provider} link`,
    retryable: false,
    provider,
    url,
    rejected,
  };
}

describe("provider password prompts", () => {
  afterEach(() => {
    vi.mocked(api.setProviderPassword).mockReset();
  });

  it("prompts, stores the password and retries the operation", async () => {
    vi.mocked(api.setProviderPassword).mockResolvedValue(undefined);
    const url = "https://mega.nz/#P!protected";
    const seen: ProviderPasswordRequest[] = [];
    const unsubscribe = subscribeProviderPassword((request) => {
      if (!request) return;
      seen.push(request);
      resolveProviderPassword({ password: "open sesame", remember: true });
    });

    let attempts = 0;
    const result = await withProviderPassword(url, async () => {
      attempts += 1;
      if (attempts === 1) throw passwordError(url);
      return "played";
    });

    expect(result).toBe("played");
    expect(attempts).toBe(2);
    expect(seen).toHaveLength(1);
    expect(api.setProviderPassword).toHaveBeenCalledWith(
      url,
      "open sesame",
      true,
    );
    unsubscribe();
  });

  it("re-prompts after a rejected password and stops on cancel", async () => {
    const url = "https://drive.proton.me/urls/token#urlpassword";
    const messages: Array<string | undefined> = [];
    const unsubscribe = subscribeProviderPassword((request) => {
      if (!request) return;
      messages.push(request.message);
      resolveProviderPassword(
        messages.length === 1
          ? { password: "wrong", remember: true }
          : null,
      );
    });

    await expect(
      withProviderPassword(url, async () => {
        throw passwordError(url, "Proton Drive");
      }),
    ).rejects.toMatchObject({ code: "password_required" });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("didn't work");
    unsubscribe();
  });

  it("explains a rejected saved password on the first prompt", async () => {
    vi.mocked(api.setProviderPassword).mockResolvedValue(undefined);
    const messages: Array<string | undefined> = [];
    const unsubscribe = subscribeProviderPassword((request) => {
      if (!request) return;
      messages.push(request.message);
      resolveProviderPassword({ password: "new password", remember: true });
    });

    let attempts = 0;
    await withProviderPassword("https://mega.nz/#P!saved", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw passwordError("https://mega.nz/#P!saved", "MEGA", true);
      }
      return "ok";
    });

    expect(messages[0]).toContain("saved password");
    unsubscribe();
  });

  it("does not mark a different link's first prompt as a rejected password", async () => {
    vi.mocked(api.setProviderPassword).mockResolvedValue(undefined);
    const messages: Array<string | undefined> = [];
    const unsubscribe = subscribeProviderPassword((request) => {
      if (!request) return;
      messages.push(request.message);
      resolveProviderPassword({ password: "pw", remember: false });
    });

    let calls = 0;
    const result = await withProviderPassword("", async () => {
      calls += 1;
      if (calls === 1) throw passwordError("https://mega.nz/#P!one");
      if (calls === 2) throw passwordError("https://mega.nz/#P!two");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(messages).toEqual([undefined, undefined]);
    unsubscribe();
  });

  it("handles concurrent prompts in order", async () => {
    vi.mocked(api.setProviderPassword).mockResolvedValue(undefined);
    const urls: string[] = [];
    const unsubscribe = subscribeProviderPassword((request) => {
      if (!request) return;
      urls.push(request.url);
      resolveProviderPassword({ password: `pw-${urls.length}`, remember: false });
    });

    const first = withProviderPassword("https://mega.nz/#P!one", async () => {
      if (urls.length < 1) throw passwordError("https://mega.nz/#P!one");
      return "first";
    });
    const second = withProviderPassword("https://mega.nz/#P!two", async () => {
      if (urls.length < 2) throw passwordError("https://mega.nz/#P!two");
      return "second";
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(urls).toEqual([
      "https://mega.nz/#P!one",
      "https://mega.nz/#P!two",
    ]);
    unsubscribe();
  });
});
