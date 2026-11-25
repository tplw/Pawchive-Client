import { useState } from "react";
import {
  CalendarClock,
  LoaderCircle,
  Play,
  Power,
  PowerOff,
  Trash2,
} from "lucide-react";
import { Button, IconButton, Modal } from "../../../shared/ui";
import { formatDate } from "../../../shared/lib/format";
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

export function DownloadSchedules({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const schedules = useDownloadSchedules();
  const [confirmDelete, setConfirmDelete] =
    useState<CreatorDownloadSchedule | null>(null);

  const close = () => {
    setConfirmDelete(null);
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Scheduled downloads"
        description="Creator downloads run while Pawchive is open."
      >
        {schedules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line/70 px-4 py-8 text-center">
            <CalendarClock className="mx-auto h-5 w-5 text-accent/70" />
            <p className="mt-2 text-xs font-semibold text-ink">
              No schedules yet
            </p>
            <p className="mx-auto mt-1 max-w-64 text-[10px] leading-relaxed text-muted">
              Choose a creator, set the filters you want, then use Schedule in
              the download dialog.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                onDelete={() => setConfirmDelete(schedule)}
              />
            ))}
          </div>
        )}
        {confirmDelete ? (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/[0.06] p-2.5">
            <p className="text-[11px] font-semibold text-ink">
              Delete the schedule for {confirmDelete.creator.name}?
            </p>
            <p className="mt-0.5 text-[9px] text-muted">
              Files already downloaded will stay on disk.
            </p>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  deleteSchedule(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete schedule
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
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
    <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-base/20 px-2 py-1.5">
      <CreatorAvatar
        service={schedule.creator.service as Service}
        id={schedule.creator.id}
        name={schedule.creator.name}
        size="xs"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[11px] font-semibold text-ink">
            {schedule.creator.name}
          </p>
          <ServiceBadge service={schedule.creator.service} />
          {!schedule.enabled ? (
            <span className="text-[8px] font-semibold uppercase tracking-wider text-muted">
              Paused
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[9px] text-muted">
          {describeSchedule(schedule)} · Next{" "}
          {formatDate(Math.floor(schedule.nextRunAt / 1000))}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={running ? "Running schedule" : "Run now"}
          icon={running ? LoaderCircle : Play}
          iconClassName={running ? "animate-spin" : undefined}
          size="sm"
          disabled={running}
          onClick={() => void runNow()}
        />
        <IconButton
          label={schedule.enabled ? "Pause schedule" : "Resume schedule"}
          icon={schedule.enabled ? Power : PowerOff}
          active={schedule.enabled}
          size="sm"
          onClick={() =>
            updateSchedule(schedule.id, { enabled: !schedule.enabled })
          }
        />
        <IconButton
          label="Delete schedule"
          icon={Trash2}
          size="sm"
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
