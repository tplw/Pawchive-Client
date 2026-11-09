import type { AppSettings, UpdateInfo } from "../../../types";

/**
 * Returns the release version that should be announced in the update prompt.
 * A version is only announced until the user dismisses that exact version;
 * the prompt returns automatically for any newer release.
 */
export function pendingUpdateVersion(
  info: UpdateInfo | null,
  settings: Pick<AppSettings, "dismissedUpdateVersion">,
): string | null {
  if (!info?.updateAvailable) return null;
  if (info.latestVersion === settings.dismissedUpdateVersion) return null;
  return info.latestVersion;
}
