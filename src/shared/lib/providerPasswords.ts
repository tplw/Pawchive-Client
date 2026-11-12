import { api } from "../api";
import { isAppError } from "./constants";

export type ProviderPasswordProvider = "mega" | "proton";

export interface ProviderPasswordRequest {
  url: string;
  provider: ProviderPasswordProvider;
  /** Set when a previous password was rejected. */
  message?: string;
}

export interface ProviderPasswordResult {
  password: string;
  remember: boolean;
}

interface PendingRequest {
  request: ProviderPasswordRequest;
  resolve: (result: ProviderPasswordResult | null) => void;
}

let current: PendingRequest | null = null;
const queue: PendingRequest[] = [];
let listener: ((request: ProviderPasswordRequest | null) => void) | null =
  null;

function showNext(): void {
  if (current || !listener) return;
  const next = queue.shift();
  if (!next) {
    listener(null);
    return;
  }
  current = next;
  listener(next.request);
}

/** Mounted once by the app shell. Multiple requests are shown in order. */
export function subscribeProviderPassword(
  next: (request: ProviderPasswordRequest | null) => void,
): () => void {
  listener = next;
  if (current) next(current.request);
  return () => {
    if (listener === next) listener = null;
    if (current) {
      current.resolve(null);
      current = null;
    }
    while (queue.length > 0) queue.shift()?.resolve(null);
  };
}

/** Resolve the currently open prompt. Used by the dialog. */
export function resolveProviderPassword(
  result: ProviderPasswordResult | null,
): void {
  if (!current) return;
  const pending = current;
  current = null;
  pending.resolve(result);
  showNext();
}

function requestProviderPassword(
  request: ProviderPasswordRequest,
): Promise<ProviderPasswordResult | null> {
  if (!listener) return Promise.resolve(null);
  return new Promise((resolve) => {
    queue.push({ request, resolve });
    showNext();
  });
}

export function providerForPasswordUrl(
  url: string,
): ProviderPasswordProvider | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "drive.proton.me" || host === "www.drive.proton.me") {
      return "proton";
    }
    if (/^(?:www\.)?mega\.(?:nz|co\.nz|io)$/.test(host)) {
      return "mega";
    }
  } catch {
    // Fall through to the provider carried by the structured error.
  }
  return null;
}

function providerFromError(value: string | undefined): ProviderPasswordProvider | null {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("proton")) return "proton";
  if (normalized.includes("mega")) return "mega";
  return null;
}

export function passwordRequiredInfo(
  error: unknown,
): {
  url?: string;
  provider?: ProviderPasswordProvider;
  rejected?: boolean;
} | null {
  if (!isAppError(error) || error.code !== "password_required") return null;
  return {
    url: error.url,
    provider: providerFromError(error.provider) ?? undefined,
    rejected: error.rejected === true,
  };
}

/**
 * Run an operation and, when the backend asks for a provider password, prompt
 * and retry. A rejected password removes the stored value in the backend and
 * loops back through the prompt with an explanatory message.
 */
export async function withProviderPassword<T>(
  fallbackUrl: string,
  run: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  let lastUrl: string | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const info = passwordRequiredInfo(error);
      if (!info) throw error;
      lastError = error;
      const url = info.url ?? fallbackUrl;
      const provider = info.provider ?? providerForPasswordUrl(url);
      if (!provider) throw error;
      const isSameLink = lastUrl === url;
      const result = await requestProviderPassword({
        url,
        provider,
        message: isSameLink
          ? "That password didn't work. If it changed, enter the new one."
          : info.rejected
            ? "The saved password didn't work. If it changed, enter the new one."
            : undefined,
      });
      if (!result) throw error;
      lastUrl = url;
      await api.setProviderPassword(url, result.password, result.remember);
    }
  }
  throw lastError;
}
