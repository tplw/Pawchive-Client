import type { AppErrorShape, AppSettings, MediaKind, PawchiveConfig } from "../types";
import { isMobile } from "./platform";

export const FALLBACK_CONFIG: PawchiveConfig = {
  apiBase: "https://pawchive.pw/api/v1",
  staticBase: "https://pawchive.pw",
  imageBase: "https://img.pawchive.pw",
  fileBase: "https://file.pawchive.pw/data",
  appName: "Pawchive",
  appVersion: "1.0.3",
  userAgent: "PawchiveClient",
  defaultTimeoutSecs: 30,
  defaultConcurrency: 8,
  defaultRetries: 3,
  cacheTtlSecs: 300,
  pageSize: 50,
};

export const DEFAULT_SETTINGS: AppSettings = {
  sidebarVisible: true,
  volume: 1,
  playbackSpeed: 1,
  downloadDir: "",
  hiddenKeywords: [],
  hideAiPosts: false,
  postCardSize: isMobile ? "small" : "medium",
  autoplayNext: true,
  resumePlayback: true,
  reduceMotion: false,
  accentColor: "#d6aea8",
  hideNoMedia: false,
  hideUnavailablePosts: false,
  autoDetectAsmr: true,
  autoSyncFavorites: false,
  cacheSizeMb: 64,
  mediaCacheSizeMb: 512,
  cacheMedia: false,
  transcodeMedia: false,
  loadAheadPages: 1,
  showCreatorUpdated: false,
  autoCheckUpdates: true,
  dismissedUpdateVersion: "",
};

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const MEDIA_LABELS: Record<MediaKind, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
  other: "Other files",
};

export const SERVICE_LABELS: Record<string, string> = {
  patreon: "Patreon",
  fanbox: "Pixiv Fanbox",
  discord: "Discord",
  gumroad: "Gumroad",
  subscribestar: "SubscribeStar",
};

export function isAppError(value: unknown): value is AppErrorShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    "code" in value
  );
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) return value.message;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Something went wrong.";
}

export function errorRetryable(value: unknown): boolean {
  return isAppError(value) && value.retryable;
}

export function creatorAvatar(config: PawchiveConfig, service: string, id: string) {
  return `${config.staticBase.replace(/\/$/, "")}/icons/${encodeURIComponent(service)}/${encodeURIComponent(id)}`;
}

export function creatorBanner(config: PawchiveConfig, service: string, id: string) {
  return `${config.staticBase.replace(/\/$/, "")}/banners/${encodeURIComponent(service)}/${encodeURIComponent(id)}`;
}

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service.toLowerCase()] ?? service;
}
