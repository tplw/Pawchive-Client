import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../app/store";
import { api } from "../../../shared/api";
import type { PostPage, PostSummary } from "../../../shared/types";
import {
  createCreatorDownloadSchedule,
  computeNextRun,
  deleteSchedule,
  describeSchedule,
  DOWNLOAD_SCHEDULES_KEY,
  loadSchedules,
  markScheduleRun,
  runCreatorDownloadSchedule,
  updateSchedule,
} from "./downloadSchedules";
import type { CreatorDownloadFilters } from "./creatorDownload";

const filters: CreatorDownloadFilters = {
  fromDate: "2026-01-01",
  toDate: "2026-01-31",
  maxPosts: 50,
  keywords: ["spoiler"],
  mediaKinds: ["image", "video"],
  skipUnavailable: false,
  skipExisting: true,
  order: "newest",
};

function post(id: string): PostSummary {
  return {
    id,
    service: "patreon",
    user: "42",
    creatorName: "Ada",
    title: `Post ${id}`,
    excerpt: "",
    published: 1_700_000_000,
    added: 1_700_000_000,
    thumbnailUrl: null,
    attachmentCount: 1,
    mediaKinds: ["image"],
    previewState: null,
    hasFull: null,
    imported: true,
    exceedsLimit: false,
    unavailable: false,
  } as PostSummary;
}

describe("creator download schedules", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({ toasts: [] });
    vi.restoreAllMocks();
  });

  it("computes daily and weekly next runs in local time", () => {
    const now = new Date(2026, 0, 15, 8, 0, 0).getTime();
    expect(computeNextRun(now, "daily", "09:00", 1)).toBe(
      new Date(2026, 0, 15, 9, 0, 0).getTime(),
    );
    expect(computeNextRun(now, "daily", "07:00", 1)).toBe(
      new Date(2026, 0, 16, 7, 0, 0).getTime(),
    );

    const weekly = computeNextRun(now, "weekly", "09:00", 5);
    expect(weekly).toBe(new Date(2026, 0, 16, 9, 0, 0).getTime());
    expect(new Date(weekly).getDay()).toBe(5);
  });

  it("stores, updates and deletes schedules", () => {
    const schedule = createCreatorDownloadSchedule({
      creator: { service: "patreon", id: "42", name: "Ada" },
      filters,
      frequency: "weekly",
      time: "18:30",
      weekday: 5,
    });

    const stored = loadSchedules();
    expect(stored).toHaveLength(1);
    expect(stored[0].creator).toMatchObject({ id: "42", name: "Ada" });
    expect(stored[0].filters.fromDate).toBe("");
    expect(stored[0].filters.toDate).toBe("");
    expect(stored[0].filters.skipExisting).toBe(true);
    expect(describeSchedule(schedule)).toContain("Friday at 18:30");

    updateSchedule(schedule.id, { enabled: false });
    expect(loadSchedules()[0].enabled).toBe(false);

    markScheduleRun(schedule.id, Date.now());
    expect(loadSchedules()[0].lastRunAt).not.toBeNull();

    deleteSchedule(schedule.id);
    expect(loadSchedules()).toHaveLength(0);
    expect(window.localStorage.getItem(DOWNLOAD_SCHEDULES_KEY)).toBe("[]");
  });

  it("runs a schedule with the saved media filters and skips existing files", async () => {
    const page: PostPage = {
      items: [post("1")],
      offset: 0,
      hasMore: false,
    };
    vi.spyOn(api, "getCreatorDownloadPosts").mockResolvedValue(page);
    vi.spyOn(api, "downloadCreatorPosts").mockResolvedValue({
      posts: 1,
      queued: 1,
      skipped: 0,
      locked: 0,
      failed: 0,
      folder: "Ada",
    });

    const schedule = createCreatorDownloadSchedule({
      creator: { service: "patreon", id: "42", name: "Ada" },
      filters,
      frequency: "daily",
      time: "09:00",
      weekday: 1,
    });

    const result = await runCreatorDownloadSchedule(schedule);

    expect(result?.queued).toBe(1);
    expect(api.downloadCreatorPosts).toHaveBeenCalledWith({
      service: "patreon",
      creatorId: "42",
      postIds: ["1"],
      mediaKinds: ["image", "video"],
      skipExisting: true,
    });
    expect(loadSchedules()[0].lastRunAt).not.toBeNull();
    expect(useAppStore.getState().toasts[0]?.title).toBe(
      "Scheduled download",
    );
  });
});
