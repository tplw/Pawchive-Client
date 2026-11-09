import type { DownloadRecord } from "../../../shared/types";

/**
 * Merge a download progress event into the cached download list. Progress
 * events are partial in practice, so existing fields are preserved. A record
 * that is not in the cache yet is prepended, matching the previous behavior.
 */
export function mergeDownloadProgress(
  records: DownloadRecord[] | undefined,
  update: DownloadRecord,
): DownloadRecord[] | undefined {
  if (!records) return records;
  const index = records.findIndex((record) => record.id === update.id);
  if (index === -1) return [update, ...records];
  const next = records.slice();
  next[index] = { ...next[index], ...update };
  return next;
}
