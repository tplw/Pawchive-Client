import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: vi.fn(),
});

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:test");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// jsdom can be configured without a usable storage area (opaque origin). The
// app relies on localStorage for creator filters and player progress, so give
// tests a small in-memory implementation when the environment lacks one.
try {
  void window.localStorage.length;
} catch {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key: string) {
        return values.get(String(key)) ?? null;
      },
      key(index: number) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key: string) {
        values.delete(String(key));
      },
      setItem(key: string, value: string) {
        values.set(String(key), String(value));
      },
    },
  });
}

if (!("PictureInPicture" in window)) {
  Object.defineProperty(document, "pictureInPictureElement", {
    configurable: true,
    value: null,
  });
}
