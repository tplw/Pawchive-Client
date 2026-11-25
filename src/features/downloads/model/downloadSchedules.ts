import { useEffect, useState } from "react";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import { queryClient } from "../../../shared/lib/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { CreatorDownloadResult, MediaKind } from "../../../shared/types";
import {
  scanCreatorDownloadPosts,
  type CreatorDownloadFilters,
} from "./creatorDownload";

export type CreatorScheduleFrequency = "daily" | "weekly";

export interface CreatorDownloadSchedule {
  id: string;
  creator: { service: string; id: string; name: string };
  filters: CreatorDownloadFilters;
  frequency: CreatorScheduleFrequency;
  /** Local time in HH:MM. */
  time: string;
  /** 0 = Sunday, 6 = Saturday. Used for weekly schedules. */
  weekday: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
}

export const DOWNLOAD_SCHEDULES_KEY = "pawchive-creator-download-schedules";
export const DOWNLOAD_SCHEDULES_EVENT = "pawchive:download-schedules";

const MEDIA_KINDS: MediaKind[] = [
  "image",
  "video",
  "audio",
  "document",
  "other",
];

const runningSchedules = new Set<string>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hours: 9, minutes: 0 };
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return { hours, minutes };
}

export function computeNextRun(
  now: number,
  frequency: CreatorScheduleFrequency,
  time: string,
  weekday: number,
): number {
  const { hours, minutes } = parseTime(time);
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hours, minutes, 0, 0);

  if (frequency === "weekly") {
    const target = Math.min(6, Math.max(0, Math.floor(weekday)));
    let days = (target - next.getDay() + 7) % 7;
    if (days === 0 && next.getTime() <= now) days = 7;
    next.setDate(next.getDate() + days);
    return next.getTime();
  }

  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function normalizeSchedule(value: unknown): CreatorDownloadSchedule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CreatorDownloadSchedule>;
  if (
    !raw.creator ||
    typeof raw.creator.service !== "string" ||
    typeof raw.creator.id !== "string" ||
    typeof raw.creator.name !== "string" ||
    !raw.filters ||
    !Array.isArray(raw.filters.mediaKinds)
  ) {
    return null;
  }
  const mediaKinds = raw.filters.mediaKinds.filter((kind): kind is MediaKind =>
    MEDIA_KINDS.includes(kind as MediaKind),
  );
  if (mediaKinds.length === 0) return null;
  const maxPosts = Number(raw.filters.maxPosts);
  const nextRunAt = Number(raw.nextRunAt);
  const now = Date.now();
  return {
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id
        : `${raw.creator.service}:${raw.creator.id}`,
    creator: {
      service: raw.creator.service,
      id: raw.creator.id,
      name: raw.creator.name || raw.creator.id,
    },
    filters: {
      fromDate: "",
      toDate: "",
      maxPosts: Number.isFinite(maxPosts)
        ? Math.min(500, Math.max(1, Math.floor(maxPosts)))
        : 50,
      keywords: Array.isArray(raw.filters.keywords)
        ? raw.filters.keywords.filter(
            (keyword): keyword is string => typeof keyword === "string",
          )
        : [],
      mediaKinds,
      skipUnavailable: Boolean(raw.filters.skipUnavailable),
      skipExisting: raw.filters.skipExisting !== false,
      order: raw.filters.order === "oldest" ? "oldest" : "newest",
    },
    frequency: raw.frequency === "weekly" ? "weekly" : "daily",
    time: typeof raw.time === "string" ? raw.time : "09:00",
    weekday:
      typeof raw.weekday === "number" ? Math.min(6, Math.max(0, raw.weekday)) : 1,
    enabled: raw.enabled !== false,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : now,
    lastRunAt:
      typeof raw.lastRunAt === "number" && Number.isFinite(raw.lastRunAt)
        ? raw.lastRunAt
        : null,
    nextRunAt: Number.isFinite(nextRunAt)
      ? nextRunAt
      : computeNextRun(now, raw.frequency === "weekly" ? "weekly" : "daily", raw.time ?? "09:00", raw.weekday ?? 1),
  };
}

export function loadSchedules(): CreatorDownloadSchedule[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(DOWNLOAD_SCHEDULES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSchedule)
      .filter((schedule): schedule is CreatorDownloadSchedule => Boolean(schedule));
  } catch {
    return [];
  }
}

export function saveSchedules(schedules: CreatorDownloadSchedule[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(DOWNLOAD_SCHEDULES_KEY, JSON.stringify(schedules));
    window.dispatchEvent(new Event(DOWNLOAD_SCHEDULES_EVENT));
  } catch {
    // Schedules still work for the current session if storage is unavailable.
  }
}

export function createCreatorDownloadSchedule({
  creator,
  filters,
  frequency,
  time,
  weekday,
}: {
  creator: { service: string; id: string; name: string };
  filters: CreatorDownloadFilters;
  frequency: CreatorScheduleFrequency;
  time: string;
  weekday: number;
}): CreatorDownloadSchedule {
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`;
  const schedule: CreatorDownloadSchedule = {
    id,
    creator,
    filters: {
      ...filters,
      fromDate: "",
      toDate: "",
      skipExisting: filters.skipExisting !== false,
    },
    frequency,
    time,
    weekday,
    enabled: true,
    createdAt: now,
    lastRunAt: null,
    nextRunAt: computeNextRun(now, frequency, time, weekday),
  };
  saveSchedules([...loadSchedules(), schedule]);
  return schedule;
}

export function updateSchedule(
  id: string,
  patch: Partial<Pick<CreatorDownloadSchedule, "enabled">>,
): void {
  saveSchedules(
    loadSchedules().map((schedule) =>
      schedule.id === id ? { ...schedule, ...patch } : schedule,
    ),
  );
}

export function updateScheduleSettings(
  id: string,
  settings: {
    frequency: CreatorScheduleFrequency;
    time: string;
    weekday: number;
    filters: CreatorDownloadFilters;
  },
): void {
  const now = Date.now();
  saveSchedules(
    loadSchedules().map((schedule) =>
      schedule.id === id
        ? {
            ...schedule,
            frequency: settings.frequency,
            time: settings.time,
            weekday: settings.weekday,
            filters: {
              ...settings.filters,
              fromDate: "",
              toDate: "",
              skipExisting: settings.filters.skipExisting !== false,
            },
            nextRunAt: computeNextRun(
              now,
              settings.frequency,
              settings.time,
              settings.weekday,
            ),
          }
        : schedule,
    ),
  );
}

export function deleteSchedule(id: string): void {
  saveSchedules(loadSchedules().filter((schedule) => schedule.id !== id));
}

export function markScheduleRun(id: string, ranAt = Date.now()): void {
  saveSchedules(
    loadSchedules().map((schedule) =>
      schedule.id === id
        ? {
            ...schedule,
            lastRunAt: ranAt,
            nextRunAt: computeNextRun(
              ranAt,
              schedule.frequency,
              schedule.time,
              schedule.weekday,
            ),
          }
        : schedule,
    ),
  );
}

export function describeSchedule(schedule: CreatorDownloadSchedule): string {
  if (schedule.frequency === "weekly") {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return `Weekly on ${days[schedule.weekday] ?? "Monday"} at ${schedule.time}`;
  }
  return `Daily at ${schedule.time}`;
}

/**
 * Run one scheduled creator download. Uses the newest matching posts and the
 * schedule's saved skip setting, so a schedule can either pick up only new
 * media or force a full refresh.
 */
export async function runCreatorDownloadSchedule(
  schedule: CreatorDownloadSchedule,
): Promise<CreatorDownloadResult | null> {
  if (runningSchedules.has(schedule.id)) return null;
  runningSchedules.add(schedule.id);
  try {
    const filters = {
      ...schedule.filters,
      fromDate: "",
      toDate: "",
    };
    const scan = await scanCreatorDownloadPosts({
      service: schedule.creator.service,
      creatorId: schedule.creator.id,
      filters,
    });
    if (scan.posts.length === 0) {
      useAppStore.getState().toast(
        "info",
        "Scheduled download",
        `${schedule.creator.name}: no matching posts.`,
      );
      return null;
    }
    const result = await api.downloadCreatorPosts({
      service: schedule.creator.service,
      creatorId: schedule.creator.id,
      postIds: scan.posts.map((post) => post.id),
      mediaKinds: filters.mediaKinds,
      skipExisting: filters.skipExisting,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.downloads() });
    useAppStore.getState().toast(
      result.queued > 0 ? "success" : "info",
      "Scheduled download",
      result.queued > 0
        ? `${schedule.creator.name}: ${result.queued} new file${
            result.queued === 1 ? "" : "s"
          }.${result.folder ? ` Saved in ${result.folder}.` : ""}`
        : `${schedule.creator.name}: no new files.`,
    );
    return result;
  } catch (error) {
    useAppStore
      .getState()
      .reportError(error, `Could not run scheduled download for ${schedule.creator.name}`);
    return null;
  } finally {
    runningSchedules.delete(schedule.id);
    markScheduleRun(schedule.id);
  }
}

/** Check enabled schedules once a minute while the app is open. */
export function useDownloadScheduler(): void {
  const ready = useAppStore((state) => state.ready);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      const now = Date.now();
      for (const schedule of loadSchedules()) {
        if (schedule.enabled && schedule.nextRunAt <= now) {
          void runCreatorDownloadSchedule(schedule);
        }
      }
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [ready]);
}

/** Read the schedule list and refresh when it changes from any view. */
export function useDownloadSchedules(): CreatorDownloadSchedule[] {
  const [schedules, setSchedules] = useState(() => loadSchedules());
  useEffect(() => {
    const sync = () => setSchedules(loadSchedules());
    window.addEventListener(DOWNLOAD_SCHEDULES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DOWNLOAD_SCHEDULES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return schedules;
}
