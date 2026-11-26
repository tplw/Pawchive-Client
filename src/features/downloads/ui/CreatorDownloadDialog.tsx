import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Check,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import { errorMessage } from "../../../shared/lib/constants";
import { isCreatorBlocked } from "../../../shared/lib/blockedCreators";
import { useDebouncedValue } from "../../../shared/lib/useDebouncedValue";
import { cn, formatDate } from "../../../shared/lib/format";
import { queryKeys } from "../../../shared/query/keys";
import {
  Button,
  Field,
  Modal,
  Spinner,
  TextInput,
  Toggle,
} from "../../../shared/ui";
import { CreatorAvatar, ServiceBadge } from "../../creators/ui/CreatorVisuals";
import type { MediaKind, PostSummary, Service } from "../../../shared/types";
import {
  createCreatorDownloadSchedule,
  describeSchedule,
  type CreatorScheduleFrequency,
} from "../model/downloadSchedules";
import {
  parseBlacklistKeywords,
  scanCreatorDownloadPosts,
  sortCreatorDownloadPosts,
  type CreatorDownloadFilters,
  type CreatorDownloadOrder,
  type CreatorDownloadScanResult,
} from "../model/creatorDownload";
import { useDownloadActions } from "../model/useDownloadActions";

const PAGE_SIZE = 50;
const MAX_POSTS = 500;

const MEDIA_OPTIONS: Array<{
  kind: MediaKind;
  label: string;
  icon: typeof ImageIcon;
}> = [
  { kind: "image", label: "Images", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Film },
  { kind: "audio", label: "Audio", icon: Music2 },
  { kind: "document", label: "Documents", icon: FileText },
  { kind: "other", label: "Other files", icon: FileText },
];

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music2,
  document: FileText,
  other: FileText,
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface SelectedCreator {
  service: string;
  id: string;
  name: string;
}

function localDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateInput(date);
}

function PostThumb({ post }: { post: PostSummary }) {
  const [failed, setFailed] = useState(false);
  const kind = post.mediaKinds[0] ?? "other";
  const Icon = KIND_ICON[kind];
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-line/60 bg-elevated">
      {post.thumbnailUrl && !failed ? (
        <img
          src={post.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="h-5 w-5 text-accent/60" />
      )}
    </div>
  );
}

export function CreatorDownloadDialog({
  open,
  onClose,
  creator,
}: {
  open: boolean;
  onClose: () => void;
  creator?: { service: string; id: string; name: string };
}) {
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const blockedCreators = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const { downloadCreatorPosts } = useDownloadActions();

  const creatorService = creator?.service;
  const creatorId = creator?.id;
  const creatorName = creator?.name;
  const [selectedCreator, setSelectedCreator] =
    useState<SelectedCreator | null>(
      creatorService && creatorId
        ? { service: creatorService, id: creatorId, name: creatorName ?? creatorId }
        : null,
    );
  const [creatorSearch, setCreatorSearch] = useState("");
  const debouncedCreatorSearch = useDebouncedValue(creatorSearch.trim(), 250);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [maxPosts, setMaxPosts] = useState("50");
  const [blacklistText, setBlacklistText] = useState("");
  const [mediaKinds, setMediaKinds] = useState<MediaKind[]>([
    "image",
    "video",
    "audio",
  ]);
  const [skipUnavailable, setSkipUnavailable] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [order, setOrder] = useState<CreatorDownloadOrder>("newest");
  const [scan, setScan] = useState<CreatorDownloadScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState({ scanned: 0, matched: 0 });
  const [scanSignature, setScanSignature] = useState<string | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] =
    useState<CreatorScheduleFrequency>("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const scanAbort = useRef<AbortController | null>(null);
  const lastOpenKey = useRef<string | null>(null);

  const keywords = useMemo(
    () => parseBlacklistKeywords(blacklistText),
    [blacklistText],
  );
  const parsedMaxPosts = Number(maxPosts);
  const clampedMaxPosts = Number.isFinite(parsedMaxPosts)
    ? Math.min(MAX_POSTS, Math.max(1, Math.floor(parsedMaxPosts)))
    : 50;
  const filters: CreatorDownloadFilters = {
    fromDate,
    toDate,
    maxPosts: clampedMaxPosts,
    keywords,
    mediaKinds,
    skipUnavailable,
    skipExisting,
    order,
  };
  const filterSignature = JSON.stringify({
    fromDate,
    toDate,
    maxPosts: clampedMaxPosts,
    keywords,
    mediaKinds: [...mediaKinds].sort(),
    skipUnavailable,
  });
  const filtersChanged =
    scan !== null && scanSignature !== null && scanSignature !== filterSignature;
  const displayedPosts = useMemo(
    () => (scan ? sortCreatorDownloadPosts(scan.posts, order) : []),
    [order, scan],
  );
  const availablePosts = useMemo(
    () => displayedPosts.filter((post) => !post.unavailable),
    [displayedPosts],
  );
  const allSelected =
    availablePosts.length > 0 &&
    availablePosts.every((post) => selectedPosts.has(post.id));
  const canDownload =
    Boolean(selectedCreator) &&
    Boolean(scan) &&
    !filtersChanged &&
    selectedPosts.size > 0 &&
    !scanning &&
    !starting;

  const creators = useQuery({
    queryKey: queryKeys.creatorsDirectory(debouncedCreatorSearch, "", "popular"),
    queryFn: () =>
      api.listCreators({
        query: debouncedCreatorSearch || undefined,
        sort: "popular",
        offset: 0,
        limit: 20,
      }),
    enabled: open && !selectedCreator,
    staleTime: 60_000,
  });
  const favorites = useQuery({
    queryKey: queryKeys.favoritesCreators(),
    queryFn: () => api.listFavoriteCreators(),
    enabled: open && !selectedCreator,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) {
      lastOpenKey.current = null;
      scanAbort.current?.abort();
      scanAbort.current = null;
      return;
    }
    const key = `${creatorService ?? ""}:${creatorId ?? ""}`;
    if (lastOpenKey.current === key) {
      if (creatorService && creatorId && creatorName) {
        setSelectedCreator((current) =>
          current &&
          current.service === creatorService &&
          current.id === creatorId
            ? { ...current, name: creatorName }
            : current,
        );
      }
      return;
    }
    lastOpenKey.current = key;
    scanAbort.current?.abort();
    scanAbort.current = null;
    setSelectedCreator(
      creatorService && creatorId
        ? {
            service: creatorService,
            id: creatorId,
            name: creatorName ?? creatorId,
          }
        : null,
    );
    setCreatorSearch("");
    setFromDate("");
    setToDate("");
    setMaxPosts("50");
    setBlacklistText("");
    setMediaKinds(["image", "video", "audio"]);
    setSkipUnavailable(false);
    setSkipExisting(true);
    setOrder("newest");
    setScheduleOpen(false);
    setScheduleFrequency("daily");
    setScheduleTime("09:00");
    setScheduleWeekday(1);
    setScan(null);
    setScanError(null);
    setScanning(false);
    setScanSignature(null);
    setSelectedPosts(new Set());
    setScanProgress({ scanned: 0, matched: 0 });
  }, [open, creatorService, creatorId, creatorName]);

  useEffect(
    () => () => {
      scanAbort.current?.abort();
    },
    [],
  );

  const chooseCreator = (next: SelectedCreator) => {
    scanAbort.current?.abort();
    scanAbort.current = null;
    setScanning(false);
    setSelectedCreator(next);
    setCreatorSearch("");
    setScan(null);
    setScanError(null);
    setScanSignature(null);
    setSelectedPosts(new Set());
  };

  const toggleMediaKind = (kind: MediaKind) => {
    setMediaKinds((current) =>
      current.includes(kind)
        ? current.filter((entry) => entry !== kind)
        : [...current, kind],
    );
  };

  const togglePost = (post: PostSummary) => {
    if (post.unavailable) return;
    setSelectedPosts((current) => {
      const next = new Set(current);
      if (next.has(post.id)) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!scan) return;
    setSelectedPosts(
      allSelected
        ? new Set()
        : new Set(availablePosts.map((post) => post.id)),
    );
  };

  const cancelScan = () => {
    scanAbort.current?.abort();
    scanAbort.current = null;
    setScanning(false);
  };

  const scanPosts = async () => {
    if (!selectedCreator) return;
    if (mediaKinds.length === 0) {
      toast("info", "Choose media types", "Select at least one type to scan.");
      return;
    }
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    const currentSignature = filterSignature;
    setScanning(true);
    setScanError(null);
    setScan(null);
    setScanSignature(null);
    setSelectedPosts(new Set());
    setScanProgress({ scanned: 0, matched: 0 });
    try {
      const result = await scanCreatorDownloadPosts({
        service: selectedCreator.service,
        creatorId: selectedCreator.id,
        filters,
        signal: controller.signal,
        onProgress: (scanned, matched) => {
          if (!controller.signal.aborted) {
            setScanProgress({ scanned, matched });
          }
        },
        pageSize: PAGE_SIZE,
      });
      if (controller.signal.aborted) return;
      setScan(result);
      setScanSignature(currentSignature);
      setSelectedPosts(
        new Set(
          result.posts
            .filter((post) => !post.unavailable)
            .map((post) => post.id),
        ),
      );
      if (result.posts.length === 0) {
        toast(
          "info",
          "No matching posts",
          "Try a wider date range or remove a blacklist word.",
        );
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setScanError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setScanning(false);
      if (scanAbort.current === controller) scanAbort.current = null;
    }
  };

  const startDownload = async () => {
    if (!selectedCreator || !canDownload) return;
    const chosenCount = selectedPosts.size;
    setStarting(true);
    try {
      const result = await downloadCreatorPosts({
        service: selectedCreator.service,
        creatorId: selectedCreator.id,
        postIds: displayedPosts
          .filter((post) => selectedPosts.has(post.id))
          .map((post) => post.id),
        mediaKinds,
        skipExisting,
      });
      const details = [
        result.skipped > 0 ? `${result.skipped} skipped` : "",
        result.locked > 0 ? `${result.locked} locked` : "",
        result.failed > 0 ? `${result.failed} failed` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (result.queued > 0) {
        toast(
          "success",
          "Creator downloads queued",
          `${result.queued} file${result.queued === 1 ? "" : "s"} from ${
            chosenCount
          } selected post${chosenCount === 1 ? "" : "s"}${
            details ? ` · ${details}` : ""
          }.${result.folder ? ` Saved in ${result.folder}.` : ""}`,
        );
      } else {
        toast(
          "info",
          "No files queued",
          details || "Everything matched was already downloaded or filtered out.",
        );
      }
      onClose();
    } catch (error) {
      reportError(error, "Could not queue creator downloads");
    } finally {
      setStarting(false);
    }
  };

  const saveSchedule = () => {
    if (!selectedCreator || mediaKinds.length === 0) return;
    setScheduleSaving(true);
    try {
      const schedule = createCreatorDownloadSchedule({
        creator: selectedCreator,
        filters,
        frequency: scheduleFrequency,
        time: scheduleTime,
        weekday: scheduleWeekday,
      });
      toast(
        "success",
        "Download scheduled",
        `${selectedCreator.name}: ${describeSchedule(
          schedule,
        )}. Runs while Pawchive is open.`,
      );
      setScheduleOpen(false);
    } catch (error) {
      reportError(error, "Could not save download schedule");
    } finally {
      setScheduleSaving(false);
    }
  };

  const close = () => {
    scanAbort.current?.abort();
    scanAbort.current = null;
    onClose();
  };

  const setPreset = (preset: "all" | "30d" | "90d" | "year") => {
    if (preset === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
    const today = localDateInput(new Date());
    if (preset === "30d") {
      setFromDate(daysAgo(30));
    } else if (preset === "90d") {
      setFromDate(daysAgo(90));
    } else {
      setFromDate(`${new Date().getFullYear()}-01-01`);
    }
    setToDate(today);
  };

  const creatorSearchText = debouncedCreatorSearch.toLowerCase();
  const matchesCreatorSearch = (entry: {
    name: string;
    public_id?: string | null;
    id: string;
  }) =>
    !creatorSearchText ||
    `${entry.name} ${entry.public_id ?? ""} ${entry.id}`
      .toLowerCase()
      .includes(creatorSearchText);
  const favoriteItems = (favorites.data ?? []).filter(
    (entry) =>
      !isCreatorBlocked(blockedCreators, entry.service, entry.id) &&
      matchesCreatorSearch(entry),
  );
  const favoriteKeys = new Set(
    favoriteItems.map((entry) => `${entry.service}:${entry.id}`),
  );
  const creatorResults = [
    ...favoriteItems,
    ...(creators.data?.items ?? []).filter(
      (entry) =>
        !isCreatorBlocked(blockedCreators, entry.service, entry.id) &&
        !favoriteKeys.has(`${entry.service}:${entry.id}`),
    ),
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      title="Download from creator"
      description="Scan a creator's posts, choose what to include, then queue the matching media."
      extraWide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={!selectedCreator || mediaKinds.length === 0 || starting}
            onClick={() => setScheduleOpen((current) => !current)}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule
          </Button>
          <Button
            variant="primary"
            disabled={!canDownload || starting}
            className="transition-none"
            onClick={() => void startDownload()}
          >
            {starting ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {selectedPosts.size > 0
              ? `Download ${selectedPosts.size} post${
                  selectedPosts.size === 1 ? "" : "s"
                }`
              : "Download posts"}
          </Button>
        </>
      }
    >
      {!selectedCreator ? (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput
              value={creatorSearch}
              onChange={(event) => setCreatorSearch(event.target.value)}
              placeholder="Search creators by name…"
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="mt-3 min-h-[52vh] max-h-[52vh] space-y-1.5 overflow-y-auto">
            {creators.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : creators.isError ? (
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs text-danger">
                {errorMessage(creators.error)}
              </div>
            ) : creatorResults.length === 0 ? (
              <div className="rounded-lg border border-line/60 bg-base/40 p-6 text-center text-xs text-muted">
                No creators match this search.
              </div>
            ) : (
              creatorResults.map((entry) => (
                <button
                  key={`${entry.service}:${entry.id}`}
                  type="button"
                  onClick={() =>
                    chooseCreator({
                      service: entry.service,
                      id: entry.id,
                      name: entry.name || entry.id,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-lg border border-line/60 bg-card/50 p-2.5 text-left transition hover:border-accent/35 hover:bg-card"
                >
                  <CreatorAvatar
                    service={entry.service}
                    id={entry.id}
                    name={entry.name || entry.id}
                    size="md"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-semibold text-ink">
                        {entry.name || entry.id}
                      </span>
                      {entry.is_favorite ||
                      favoriteKeys.has(`${entry.service}:${entry.id}`) ? (
                        <Star className="h-3 w-3 shrink-0 fill-favorite text-favorite" />
                      ) : null}
                      <ServiceBadge service={entry.service} />
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">
                      @{entry.public_id || entry.id}
                      {entry.favorited
                        ? ` · ${entry.favorited.toLocaleString()} favorites`
                        : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-line/60 bg-card/50 p-2.5">
              <CreatorAvatar
                service={selectedCreator.service as Service}
                id={selectedCreator.id}
                name={selectedCreator.name}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">
                  {selectedCreator.name}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <ServiceBadge service={selectedCreator.service} />
                  <span className="truncate text-[10px] text-muted">
                    @{selectedCreator.id}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={starting}
                onClick={() => {
                  scanAbort.current?.abort();
                  scanAbort.current = null;
                  setScanning(false);
                  setSelectedCreator(null);
                  setScan(null);
                  setScanSignature(null);
                  setSelectedPosts(new Set());
                  setScanError(null);
                }}
              >
                Change
              </Button>
            </div>

            {scheduleOpen ? (
              <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      Schedule recurring download
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                      Uses the current media types, maximum, blacklist and
                      skip settings. Runs while Pawchive is open.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setScheduleOpen(false)}
                  >
                    Close
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Repeat">
                    <select
                      value={scheduleFrequency}
                      onChange={(event) =>
                        setScheduleFrequency(
                          event.target.value as CreatorScheduleFrequency,
                        )
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
                      value={scheduleTime}
                      onChange={(event) => setScheduleTime(event.target.value)}
                      className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
                    />
                  </Field>
                  {scheduleFrequency === "weekly" ? (
                    <Field label="Day" className="col-span-2">
                      <select
                        value={scheduleWeekday}
                        onChange={(event) =>
                          setScheduleWeekday(Number(event.target.value))
                        }
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
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  loading={scheduleSaving}
                  onClick={saveSchedule}
                >
                  <CalendarClock className="h-3.5 w-3.5" /> Save schedule
                </Button>
              </div>
            ) : null}

            <Field label="Date range">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-base focus-within:border-accent/70">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                    aria-label="From date"
                    className="date-input-center h-9 w-full min-w-0 border-0 bg-transparent px-2.5 text-xs text-ink outline-none"
                  />
                </div>
                <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-base focus-within:border-accent/70">
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                    aria-label="To date"
                    className="date-input-center h-9 w-full min-w-0 border-0 bg-transparent px-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(
                  [
                    ["all", "All time"],
                    ["30d", "Last 30 days"],
                    ["90d", "Last 90 days"],
                    ["year", "This year"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPreset(value)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted transition hover:bg-elevated hover:text-ink"
                  >
                    {label}
                  </button>
                ))}
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
              <Field label="Queue order">
                <select
                  value={order}
                  onChange={(event) =>
                    setOrder(event.target.value as CreatorDownloadOrder)
                  }
                  className="h-9 w-full rounded-lg border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-accent/70"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </Field>
            </div>
            <p className="-mt-2 text-[10px] leading-relaxed text-muted">
              Scans the newest posts first and keeps the newest matches up to
              the maximum.
            </p>

            <Field
              label="Media types"
              hint="The backend only queues attachments that match the selected types."
            >
              <div className="flex flex-wrap gap-1.5">
                {MEDIA_OPTIONS.map(({ kind, label, icon: Icon }) => {
                  const active = mediaKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleMediaKind(kind)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                        active
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line/70 text-muted hover:border-line hover:text-ink",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                      {active ? <Check className="h-3 w-3" /> : null}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Skip posts containing"
              hint="Comma or newline separated. Matches the post title and excerpt."
            >
              <textarea
                value={blacklistText}
                onChange={(event) => setBlacklistText(event.target.value)}
                rows={2}
                placeholder="spoiler, commission, teaser"
                className="w-full resize-y rounded-lg border border-line bg-base px-2.5 py-2 text-xs text-ink outline-none transition placeholder:text-dim focus:border-accent/70"
              />
            </Field>

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
                description="Do not queue a file that already has a download record or exists in the creator folder."
              />
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              Locked MEGA or Proton Drive links are skipped. Unlock them on the
              post first if you want them included.
            </p>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-ink">Matching posts</p>
                <p className="mt-0.5 text-[10px] text-muted">
                  {scanning
                    ? `Scanned ${scanProgress.scanned} · ${scanProgress.matched} matched`
                    : scan
                      ? `${selectedPosts.size} of ${displayedPosts.length} posts selected · ${scan.scanned} scanned${
                          scan.truncated ? " · limited" : ""
                        }`
                      : "Scan to preview the posts in this batch."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {scan && displayedPosts.length > 0 ? (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[10px] font-medium text-accent transition hover:text-ink"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={scanning}
                  disabled={scanning || starting}
                  onClick={() => void scanPosts()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {scan ? "Rescan" : "Scan posts"}
                </Button>
                {scanning ? (
                  <Button variant="ghost" size="sm" onClick={cancelScan}>
                    Stop
                  </Button>
                ) : null}
              </div>
            </div>

            {filtersChanged ? (
              <div className="mb-2 rounded-lg border border-favorite/25 bg-favorite/5 px-3 py-2 text-[10px] text-favorite">
                Filters changed. Rescan to update this list before downloading.
              </div>
            ) : null}
            {scan?.truncated ? (
              <div className="mb-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] text-accent">
                The scan stopped at the maximum number of posts or the scan cap.
                Narrow the date range or blacklist to change the selection.
              </div>
            ) : null}
            {scanError ? (
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-4 text-center">
                <AlertCircle className="mx-auto h-5 w-5 text-danger" />
                <p className="mt-2 text-xs font-medium text-danger">
                  Could not scan this creator
                </p>
                <p className="mt-1 text-[10px] text-muted">{scanError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => void scanPosts()}
                >
                  Try again
                </Button>
              </div>
            ) : scanning ? (
              <div className="grid place-items-center rounded-lg border border-line/60 bg-base/30 py-12">
                <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
                <p className="mt-2 text-[10px] text-muted">
                  Scanning creator posts…
                </p>
              </div>
            ) : !scan ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-line/70 bg-base/20 px-5 py-12 text-center">
                <SlidersHorizontal className="h-6 w-6 text-accent/60" />
                <p className="mt-2 text-xs font-medium text-ink">
                  Set your filters and scan
                </p>
                <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted">
                  The scan only reads post summaries. Media type filtering is
                  applied again to each attachment when the download starts.
                </p>
              </div>
            ) : displayedPosts.length === 0 ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-line/70 bg-base/20 px-5 py-12 text-center">
                <AlertCircle className="h-6 w-6 text-muted" />
                <p className="mt-2 text-xs font-medium text-ink">
                  No posts match these filters
                </p>
                <p className="mt-1 max-w-xs text-[10px] text-muted">
                  Try a wider date range, fewer blacklist words, or more media
                  types.
                </p>
              </div>
            ) : (
              <div className="max-h-[48vh] space-y-1.5 overflow-y-auto pr-1">
                {displayedPosts.map((post) => {
                  const checked = selectedPosts.has(post.id);
                  const media = [
                    ...new Set(
                      (post.mediaKinds.length > 0
                        ? post.mediaKinds
                        : ["other"]) as MediaKind[],
                    ),
                  ];
                  return (
                    <label
                      key={`${post.service}:${post.user}:${post.id}`}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-2 transition",
                        post.unavailable
                          ? "cursor-not-allowed border-line/40 bg-card/20 opacity-60"
                          : "cursor-pointer",
                        checked
                          ? "border-accent/35 bg-accent/[0.07]"
                          : !post.unavailable &&
                              "border-line/60 bg-card/35 hover:border-line",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={starting || post.unavailable}
                        onChange={() => togglePost(post)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-[rgb(var(--accent))]"
                      />
                      <PostThumb post={post} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-ink">
                          {post.title || "Untitled post"}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-muted">
                          <CalendarDays className="h-3 w-3" />
                          {formatDate(post.published ?? post.added)}
                          <span>·</span>
                          {post.attachmentCount} file
                          {post.attachmentCount === 1 ? "" : "s"}
                          {post.unavailable ? (
                            <span className="text-favorite">· unavailable</span>
                          ) : null}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {media.map((kind) => {
                            const Icon = KIND_ICON[kind] ?? FileText;
                            return (
                              <span
                                key={kind}
                                title={kind}
                                className="inline-flex items-center gap-0.5 rounded border border-line/60 px-1 py-0.5 text-[8px] uppercase tracking-wider text-muted"
                              >
                                <Icon className="h-2.5 w-2.5" />
                                {kind}
                              </span>
                            );
                          })}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
