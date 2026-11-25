import { useState } from "react";
import { CalendarClock, Play, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, IconButton, Toggle } from "../../../shared/ui";
import { formatDateTime } from "../../../shared/lib/format";
import { CreatorAvatar, ServiceBadge } from "../../creators/ui/CreatorVisuals";
import type { Service } from "../../../shared/types";
import {
  deleteSchedule,
  describeSchedule,
  runCreatorDownloadSchedule,
  updateSchedule,
  useDownloadSchedules,
  type CreatorDownloadSchedule,
} from "../model/downloadSchedules";

export function DownloadSchedules() {
  const schedules = useDownloadSchedules();
  const [confirmDelete, setConfirmDelete] =
    useState<CreatorDownloadSchedule | null>(null);

  if (schedules.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl2 border border-line/70 bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-accent">
          <CalendarClock className="h-3.5 w-3.5" />
          <span className="text-[9px] font-bold uppercase tracking-[0.16em]">
            Scheduled downloads
          </span>
        </div>
        <p className="text-[10px] text-muted">Runs while Pawchive is open.</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {schedules.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            onDelete={() => setConfirmDelete(schedule)}
          />
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete download schedule?"
        message={`Stop scheduled downloads for ${
          confirmDelete?.creator.name ?? "this creator"
        }? Files already downloaded will stay.`}
        confirmLabel="Delete schedule"
        danger
        onConfirm={() => {
          if (confirmDelete) deleteSchedule(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </section>
  );
}

function ScheduleRow({
  schedule,
  onDelete,
}: {
  schedule: CreatorDownloadSchedule;
  onDelete: () => void;
}) {
  const [running, setRunning] = useState(false);

  const runNow = async () => {
    setRunning(true);
    try {
      await runCreatorDownloadSchedule(schedule);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-base/20 p-2">
      <CreatorAvatar
        service={schedule.creator.service as Service}
        id={schedule.creator.id}
        name={schedule.creator.name}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-[11px] font-semibold text-ink">
            {schedule.creator.name}
          </p>
          <ServiceBadge service={schedule.creator.service} />
        </div>
        <p className="mt-0.5 text-[9px] text-muted">
          {describeSchedule(schedule)} · Next{" "}
          {formatDateTime(Math.floor(schedule.nextRunAt / 1000))}
        </p>
        <p className="mt-0.5 text-[9px] text-dim">
          {schedule.filters.mediaKinds.length} media type
          {schedule.filters.mediaKinds.length === 1 ? "" : "s"} · up to{" "}
          {schedule.filters.maxPosts} posts
          {schedule.lastRunAt
            ? ` · last run ${formatDateTime(
                Math.floor(schedule.lastRunAt / 1000),
              )}`
            : ""}
        </p>
      </div>
      <Toggle
        compact
        checked={schedule.enabled}
        onChange={(checked) => updateSchedule(schedule.id, { enabled: checked })}
        label="Enabled"
      />
      <Button
        variant="secondary"
        size="sm"
        loading={running}
        onClick={() => void runNow()}
      >
        <Play className="h-3.5 w-3.5" /> Run now
      </Button>
      <IconButton
        label="Delete schedule"
        icon={Trash2}
        size="sm"
        onClick={onDelete}
      />
    </div>
  );
}
