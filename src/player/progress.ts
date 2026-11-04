import type { PlaybackProgress } from "../types";

/**
 * Latest watch positions for the current app session. The SQLite write is
 * asynchronous, so keeping the newest position in memory prevents a page
 * switch from racing the backend and resuming from an older position.
 */
const progressCache = new Map<string, PlaybackProgress>();

export function rememberProgress(progress: PlaybackProgress): void {
  progressCache.set(progress.filePath, progress);
}

export function cachedProgress(key: string): PlaybackProgress | null {
  return progressCache.get(key) ?? null;
}

export function clearProgressCache(): void {
  progressCache.clear();
}
