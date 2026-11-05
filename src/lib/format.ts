export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(epoch: number | null | undefined): string {
  if (!epoch) return "Unknown date";
  return dateFormatter.format(new Date(epoch * 1000));
}

export function formatDateTime(epoch: number | null | undefined): string {
  if (!epoch) return "Unknown date";
  return dateTimeFormatter.format(new Date(epoch * 1000));
}

export function formatRelative(epoch: number | null | undefined): string {
  if (!epoch) return "unknown";
  const delta = Math.round(Date.now() / 1000) - epoch;
  // A timestamp in the future is not "just now" unless it is within a small
  // clock-skew window; older builds could show "just now" indefinitely.
  if (delta < -60) return formatDate(epoch);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d ago`;
  if (delta < 86400 * 365) return `${Math.floor(delta / (86400 * 30))}mo ago`;
  return `${Math.floor(delta / (86400 * 365))}y ago`;
}

export function shortNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const scaled = value / 1000;
    const text = scaled.toFixed(value < 10_000 ? 1 : 0);
    // 999,950 rounds to "1000k"; promote it to the next unit instead.
    if (Number(text) >= 1000) return "1m";
    return `${text}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable ||
    target.closest("[data-no-shortcuts]") !== null
  );
}

export function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return [match[1], match[2], match[3]]
    .map((part) => Number.parseInt(part, 16))
    .join(" ");
}
