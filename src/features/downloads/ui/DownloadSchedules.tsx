import { useState, type ReactNode } from "react";
import {
  CalendarClock,
  LoaderCircle,
  Play,
  Power,
  PowerOff,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button, IconButton, Modal, Toggle } from "../../../shared/ui";
import { cn, formatDate } from "../../../shared/lib/format";
import { MEDIA_LABELS } from "../../../shared/lib/constants";
import { useAppStore } from "../../../app/store";
import { CreatorAvatar, ServiceBadge } from "../../creators/ui/CreatorVisuals";
import type { MediaKind, Service } from "../../../shared/types";
import {
  parseBlacklistKeywords,
  type CreatorDownloadFilters,
} from "../model/creatorDownload";
import {
  deleteSchedule,
  describeSchedule,
  runCreatorDownloadSchedule,
  updateSchedule,
  updateScheduleSettings,
  useDownloadSchedules,
  type CreatorDownloadSchedule,
  type CreatorScheduleFrequency,
} from "../model/downloadSchedules";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MEDIA_OPTIONS: MediaKind[] = [
  "image",
  "video",
  "audio",
  "document",
  "other",
];

const MAX_POSTS = 500;

export function DownloadSchedules({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const schedules = useDownloadSchedules();
  const [confirmDelete, setConfirmDelete] =
    useState<CreatorDownloadSchedule | null>(null);
  const [editing, setEditing] = useState<CreatorDownloadSchedule | null>(null);

  const close = () => {
    setConfirmDelete(null);
    setEditing(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? "Schedule settings" : "Scheduled downloads"}
      description={
        editing
          ? `${editing.creator.name} · runs while Pawchive is open.`
          : "Creator downloads run while Pawchive is open."
      }
    >
      {editing ? (
        <ScheduleEditor
          key={editing.id}
          schedule={editing}
          onCancel={() => setEditing(null)}
          onSave={(settings) => {
            updateScheduleSettings(editing.id, settings);
            setEditing(null);
            toast("success", "Schedule updated", editing.creator.name);
          }}
        />
      ) : (
        <>
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
                  onEdit={() => setEditing(schedule)}
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
        </>
      )}
    </Modal>
  );
}

function ScheduleRow({
  schedule,
  onEdit,
  onDelete,
}: {
  schedule: CreatorDownloadSchedule;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hideSourceTags = useAppStore((state) => state.settings.hideSourceTags);
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
          {hideSourceTags ? null : (
            <ServiceBadge service={schedule.creator.service} />
          )}
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
          label="Schedule settings"
          icon={Settings2}
          size="sm"
          onClick={onEdit}
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

function ScheduleEditor({
  schedule,
  onCancel,
  onSave,
}: {
  schedule: CreatorDownloadSchedule;
  onCancel: () => void;
  onSave: (settings: {
    frequency: CreatorScheduleFrequency;
    time: string;
    weekday: number;
    filters: CreatorDownloadFilters;
  }) => void;
}) {
  const [frequency, setFrequency] = useState(schedule.frequency);
  const [time, setTime] = useState(schedule.time);
  const [weekday, setWeekday] = useState(schedule.weekday);
  const [maxPosts, setMaxPosts] = useState(String(schedule.filters.maxPosts));
  const [mediaKinds, setMediaKinds] = useState<MediaKind[]>(
    schedule.filters.mediaKinds,
  );
  const [keywords, setKeywords] = useState(
    schedule.filters.keywords.join(", "),
  );
  const [skipUnavailable, setSkipUnavailable] = useState(
    schedule.filters.skipUnavailable,
  );
  const [skipExisting, setSkipExisting] = useState(
    schedule.filters.skipExisting,
  );

  const parsedMaxPosts = Number(maxPosts);
  const clampedMaxPosts = Number.isFinite(parsedMaxPosts)
    ? Math.min(MAX_POSTS, Math.max(1, Math.floor(parsedMaxPosts)))
    : schedule.filters.maxPosts;

  const toggleKind = (kind: MediaKind) => {
    setMediaKinds((current) =>
      current.includes(kind)
        ? current.filter((entry) => entry !== kind)
        : [...current, kind],
    );
  };

  const save = () => {
    if (mediaKinds.length === 0) return;
    onSave({
      frequency,
      time,
      weekday,
      filters: {
        ...schedule.filters,
        maxPosts: clampedMaxPosts,
        mediaKinds,
        keywords: parseBlacklistKeywords(keywords),
        skipUnavailable,
        skipExisting,
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Repeat">
          <select
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as CreatorScheduleFrequency)
            }
            className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
        <Field label="Time">
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
          />
        </Field>
        {frequency === "weekly" ? (
          <Field label="Day" className="col-span-2">
            <select
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
              className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
            >
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <Field
        label="Media types"
        hint="Only files of these types are queued."
      >
        <div className="flex flex-wrap gap-1.5">
          {MEDIA_OPTIONS.map((kind) => {
            const active = mediaKinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                  active
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-line/70 text-muted hover:border-line hover:text-ink",
                )}
              >
                {MEDIA_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Maximum posts">
          <input
            type="number"
            min={1}
            max={MAX_POSTS}
            value={maxPosts}
            onChange={(event) => setMaxPosts(event.target.value)}
            onBlur={() => setMaxPosts(String(clampedMaxPosts))}
            className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
          />
        </Field>
        <Field label="Skip posts containing">
          <input
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="spoiler, teaser"
            className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none transition placeholder:text-dim focus:border-accent/70"
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <Toggle
          compact
          checked={skipUnavailable}
          onChange={setSkipUnavailable}
          label="Skip unavailable posts"
          description="Skip previews that have no downloadable files."
        />
        <Toggle
          compact
          checked={skipExisting}
          onChange={setSkipExisting}
          label="Skip already downloaded"
          description="Skip files with a download record or a matching file in the creator folder."
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={mediaKinds.length === 0}
          onClick={save}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[10px] font-medium text-muted">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[9px] leading-relaxed text-dim">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
