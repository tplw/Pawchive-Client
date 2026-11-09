import type { MediaProvider } from "../../../types";

const MEGA_FILE_PATTERN =
  /^https:\/\/(?:www\.)?mega\.(?:nz|co\.nz|io)\/(?:file\/[a-z0-9_-]+#|#![a-z0-9_-]+!)/i;
const MEGA_FOLDER_FILE_PATTERN =
  /^https:\/\/(?:www\.)?mega\.(?:nz|co\.nz|io)\/(?:folder\/[a-z0-9_-]+#[^/]+\/file\/[a-z0-9_-]+|#F![a-z0-9_-]+![^!]+![a-z0-9_-]+)/i;

/** MEGA links need backend decryption before the webview can play them. */
export function isMegaFileUrl(url: string): boolean {
  return MEGA_FILE_PATTERN.test(url) || MEGA_FOLDER_FILE_PATTERN.test(url);
}

/** Providers whose links need a backend lookup before playback. */
export function needsMediaResolution(url: string): boolean {
  const provider = providerForUrl(url);
  return (
    provider === "mega" ||
    provider === "googleDrive" ||
    provider === "dropbox" ||
    provider === "gofile"
  );
}

/** Mirror of the backend provider classifier for URLs built in the UI. */
export function providerForUrl(url: string): MediaProvider {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "pawchive";
  }
  if (host === "pawchive.pw" || host.endsWith(".pawchive.pw")) {
    return "pawchive";
  }
  if (/^(?:www\.)?mega\.(?:nz|co\.nz|io)$/.test(host)) {
    return "mega";
  }
  if (
    host === "drive.google.com" ||
    host === "drive.usercontent.google.com" ||
    host === "docs.google.com"
  ) {
    return "googleDrive";
  }
  if (
    host === "dropbox.com" ||
    host.endsWith(".dropbox.com") ||
    host.endsWith(".dropboxusercontent.com")
  ) {
    return "dropbox";
  }
  if (host === "gofile.io" || host.endsWith(".gofile.io")) {
    return "gofile";
  }
  return "external";
}
