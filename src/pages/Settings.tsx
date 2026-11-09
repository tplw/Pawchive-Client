import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChevronDown,
  ExternalLink,
  Filter,
  FolderOpen,
  HardDrive,
  Info,
  LayoutGrid,
  Play,
  RefreshCw,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SPEEDS, serviceLabel } from "../lib/constants";
import { removeBlockedCreator } from "../lib/blockedCreators";
import { queryKeys } from "../shared/query/keys";
import { isAndroid, isIos, isMobile } from "../lib/platform";
import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import { AccountPanel } from "../components/AccountPanel";
import { Button, Toggle } from "../components/ui";
import type { BlockedCreator, PostCardSize } from "../types";

const ACCENT_PRESETS = [
  "#d6aea8",
  "#66d9ff",
  "#b7a4ff",
  "#7ee0c3",
  "#ffd166",
  "#ff8a78",
];

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const config = useAppStore((state) => state.config);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const updateChecking = useAppStore((state) => state.updateChecking);
  const updateError = useAppStore((state) => state.updateError);
  const checkForUpdates = useAppStore((state) => state.checkForUpdates);
  const queryClient = useQueryClient();
  const blockedCreators = settings.blockedCreators ?? [];
  const unblockCreator = async (creator: BlockedCreator) => {
    await saveSettings({
      blockedCreators: removeBlockedCreator(
        blockedCreators,
        creator.service,
        creator.id,
      ),
    });
    await queryClient.invalidateQueries();
  };
  const [volume, setVolume] = useState(settings.volume);
  const [speed, setSpeed] = useState(settings.playbackSpeed);
  const [keywordText, setKeywordText] = useState(
    (settings.hiddenKeywords ?? []).join(", "),
  );
  const [hideAi, setHideAi] = useState(settings.hideAiPosts);
  const [clearingCache, setClearingCache] = useState(false);
  // Remember the last value we tried to persist. Without this, a failed save
  // rolls the store back and the debounce effect immediately retries forever.
  const lastVolumeSave = useRef<number | null>(null);
  const lastKeywordSave = useRef<string | null>(null);
  const transcodeAvailable = useQuery({
    queryKey: queryKeys.canTranscode(),
    queryFn: () => api.canTranscode(),
    staleTime: Infinity,
  });

  useEffect(() => {
    setVolume(settings.volume);
    setSpeed(settings.playbackSpeed);
  }, [settings.volume, settings.playbackSpeed]);

  useEffect(() => {
    setKeywordText((settings.hiddenKeywords ?? []).join(", "));
    setHideAi(settings.hideAiPosts);
  }, [settings.hiddenKeywords, settings.hideAiPosts]);

  const invalidateFilters = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postsAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.searchAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.creatorPostsAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.creatorSimilarAll() });
  }, [queryClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (Math.abs(volume - settings.volume) < 0.001) {
        lastVolumeSave.current = null;
        return;
      }
      if (
        lastVolumeSave.current !== null &&
        Math.abs(lastVolumeSave.current - volume) < 0.001
      ) {
        return;
      }
      lastVolumeSave.current = volume;
      void saveSettings({ volume });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [volume, settings.volume, saveSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const keywords = keywordText
        .split(/[,\n]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .slice(0, 100);
      const serialized = JSON.stringify(keywords);
      if (serialized === JSON.stringify(settings.hiddenKeywords ?? [])) {
        lastKeywordSave.current = null;
        return;
      }
      if (lastKeywordSave.current === serialized) return;
      lastKeywordSave.current = serialized;
      void saveSettings({ hiddenKeywords: keywords }).then(invalidateFilters);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [keywordText, settings.hiddenKeywords, saveSettings, invalidateFilters]);

  const clearMediaCache = async () => {
    setClearingCache(true);
    try {
      const count = await api.clearMediaCache();
      toast("success", "Media cache cleared", `${count} file${count === 1 ? "" : "s"} removed.`);
    } catch (error) {
      reportError(error, "Could not clear the media cache");
    } finally {
      setClearingCache(false);
    }
  };

  const openDownloadsFolder = async () => {
    try {
      await api.openDownloadsFolder();
    } catch (error) {
      reportError(error, "Could not open the downloads folder");
    }
  };

  const chooseFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string") {
        await saveSettings({ downloadDir: path });
        if (useAppStore.getState().settings.downloadDir === path) {
          toast("success", "Download folder updated", path);
        }
      }
    } catch (error) {
      reportError(error, "Could not choose a download folder");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-10">
      <p className="px-0.5 text-[10px] text-dim">
        All changes save automatically.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsSection icon={Play} title="Player">
          <div className="space-y-2">
            <label className="block">
              <span className="flex items-center justify-between text-xs font-medium text-ink">
                Volume
                <span className="tabular-nums text-muted">
                  {Math.round(volume * 100)}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="mt-1 w-full"
              />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
              Speed
              <select
                value={speed}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSpeed(value);
                  void saveSettings({ playbackSpeed: value });
                }}
                className="h-8 w-24 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              compact
              checked={settings.autoplayNext}
              onChange={(checked) => void saveSettings({ autoplayNext: checked })}
              label="Autoplay next"
            />
            <Toggle
              compact
              checked={settings.resumePlayback}
              onChange={(checked) => void saveSettings({ resumePlayback: checked })}
              label="Resume position"
            />
            {!isMobile && transcodeAvailable.data ? (
              <Toggle
                compact
                checked={settings.transcodeMedia}
                onChange={(checked) =>
                  void saveSettings({ transcodeMedia: checked })
                }
                label="Transcode unsupported media"
                description="Use ffmpeg to convert incompatible video/audio for playback."
              />
            ) : null}
          </div>
        </SettingsSection>

        <SettingsSection icon={LayoutGrid} title="Layout">
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
              Card size
              <select
                value={settings.postCardSize}
                onChange={(event) =>
                  void saveSettings({
                    postCardSize: event.target.value as PostCardSize,
                  })
                }
                className="h-8 w-32 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
              >
                <option value="small">
                  Small{isMobile ? " (default)" : ""}
                </option>
                <option value="medium">
                  Medium{isMobile ? "" : " (default)"}
                </option>
                <option value="large">Large</option>
              </select>
            </label>
            <div className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
              Accent color
              <input
                type="color"
                value={settings.accentColor}
                onChange={(event) =>
                  void saveSettings({ accentColor: event.target.value })
                }
                aria-label="Accent color"
                className="h-8 w-12 cursor-pointer rounded-lg border border-line bg-base p-0.5"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use accent ${color}`}
                  onClick={() => void saveSettings({ accentColor: color })}
                  className="h-6 w-6 rounded-full border border-white/15 transition hover:scale-110"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
              Load ahead
              <select
                value={settings.loadAheadPages}
                onChange={(event) =>
                  void saveSettings({
                    loadAheadPages: Number(event.target.value),
                  })
                }
                className="h-8 w-32 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
              >
                {[1, 2, 3, 4, 5].map((pages) => (
                  <option key={pages} value={pages}>
                    {pages} page{pages === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] leading-relaxed text-muted">
              Prefetches more posts and creators before you reach the end of the
              grid. Each page contains up to 50 posts or 60 creators.
            </p>
            <Toggle
              compact
              checked={settings.showCreatorUpdated}
              onChange={(checked) =>
                void saveSettings({ showCreatorUpdated: checked })
              }
              label="Show creator update time"
              description="Display the last archive update on compact creator cards."
            />
            <Toggle
              compact
              checked={settings.reduceMotion}
              onChange={(checked) => void saveSettings({ reduceMotion: checked })}
              label="Reduce motion"
            />
          </div>
        </SettingsSection>

        <SettingsSection icon={Filter} title="Content filters">
          <div className="space-y-2">
            <Toggle
              compact
              checked={hideAi}
              onChange={(checked) => {
                setHideAi(checked);
                void saveSettings({ hideAiPosts: checked }).then(invalidateFilters);
              }}
              label="Hide AI-generated posts"
            />
            <Toggle
              compact
              checked={settings.hideNoMedia}
              onChange={(checked) => {
                void saveSettings({ hideNoMedia: checked }).then(invalidateFilters);
              }}
              label="Hide posts without media"
              description="Hide posts with no media attachments or direct media links. Also applies to every creator's filter."
            />
            <Toggle
              compact
              checked={settings.hideUnavailablePosts}
              onChange={(checked) => {
                void saveSettings({ hideUnavailablePosts: checked }).then(
                  invalidateFilters,
                );
              }}
              label="Hide unavailable posts"
              description="Hide posts that aren't imported or exceed the archive file-size limit. Posts with playable or downloadable non-image files stay visible."
            />
            <Toggle
              compact
              checked={settings.autoDetectAsmr}
              onChange={(checked) =>
                void saveSettings({ autoDetectAsmr: checked })
              }
              label="Auto-detect ASMR creators"
              description="Detect ASMR creators from their name, profile and posts, then enable audio-only automatically."
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">
                Hidden keywords
              </span>
              <textarea
                value={keywordText}
                onChange={(event) => setKeywordText(event.target.value)}
                rows={2}
                placeholder="spoiler, commission, teaser"
                className="w-full resize-y rounded-lg border border-line bg-base px-2.5 py-2 text-xs text-ink outline-none transition placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>
        </SettingsSection>

        <SettingsSection icon={Ban} title="Blocked creators">
          {blockedCreators.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">
              No blocked creators. Use the Block button on a creator profile to
              hide that creator and all of their posts everywhere.
            </p>
          ) : (
            <div className="space-y-1.5">
              {blockedCreators.map((creator) => (
                <div
                  key={`${creator.service}:${creator.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line/60 bg-base/25 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">
                      {creator.name || creator.id}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {serviceLabel(creator.service)} · {creator.id}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void unblockCreator(creator)}
                  >
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection icon={FolderOpen} title="Downloads">
          <div className="space-y-2">
            <code className="block break-all rounded-lg border border-line/70 bg-base px-2.5 py-2 text-[10px] text-muted">
              {isIos
                ? "Files → On My iPhone → Pawchive → Downloads"
                : isAndroid
                  ? "App storage → Downloads"
                  : settings.downloadDir || "Default application downloads folder"}
            </code>
            <div className="flex flex-wrap gap-2">
              {!isMobile ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Choose
                </Button>
              ) : null}
              {!isMobile ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void openDownloadsFolder()}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open folder
                </Button>
              ) : null}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection icon={HardDrive} title="Storage">
          <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
            API cache limit
            <select
              value={settings.cacheSizeMb}
              onChange={(event) =>
                void saveSettings({ cacheSizeMb: Number(event.target.value) })
              }
              className="h-8 w-32 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
            >
              {[32, 64, 128, 256, 512, 1024].map((size) => (
                <option key={size} value={size}>
                  {size} MB
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
            Media cache limit
            <select
              value={settings.mediaCacheSizeMb}
              onChange={(event) =>
                void saveSettings({
                  mediaCacheSizeMb: Number(event.target.value),
                })
              }
              className="h-8 w-32 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
            >
              {[128, 256, 512, 1024, 2048, 4096].map((size) => (
                <option key={size} value={size}>
                  {size} MB
                </option>
              ))}
            </select>
          </label>
          <Toggle
            compact
            checked={settings.cacheMedia}
            onChange={(checked) => void saveSettings({ cacheMedia: checked })}
            label="Cache viewed media"
            description="Save remote images and completed audio/video for faster repeat viewing. Nothing is cached while it is streaming."
          />
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[10px] leading-relaxed text-muted">
              API cache stays in memory. Viewed media is stored on disk and the
              oldest files are removed at the media cache limit.
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={clearingCache}
              onClick={() => void clearMediaCache()}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection icon={RefreshCw} title="Updates">
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-muted">
              Current version{" "}
              <span className="font-medium text-ink">{config.appVersion}</span>
            </p>
            <Toggle
              compact
              checked={settings.autoCheckUpdates}
              onChange={(checked) => {
                void saveSettings({ autoCheckUpdates: checked });
                if (checked) void checkForUpdates({ silent: true });
              }}
              label="Automatically check for updates"
              description="Checks GitHub for a new release when the app starts."
            />
            {updateChecking ? (
              <p className="text-[10px] text-muted">Checking for updates...</p>
            ) : null}
            {updateInfo?.updateAvailable ? (
              <div className="rounded-lg border border-accent/40 bg-accent/5 p-2.5">
                <p className="text-xs font-medium text-ink">
                  Version {updateInfo.latestVersion} is available
                </p>
                <p className="mt-0.5 text-[10px] text-muted">
                  You are on {updateInfo.currentVersion}.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-2"
                  onClick={() => void api.openExternal(updateInfo.url)}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open release
                </Button>
              </div>
            ) : null}
            {!updateInfo?.updateAvailable && updateInfo ? (
              <p className="text-[10px] text-success">
                Pawchive {updateInfo.currentVersion} is up to date.
              </p>
            ) : null}
            {!settings.autoCheckUpdates && !updateInfo?.updateAvailable ? (
              <p className="text-[10px] text-muted">
                Automatic update checks are off.
              </p>
            ) : null}
            {updateError ? (
              <p className="text-[10px] text-danger">{updateError}</p>
            ) : null}
          </div>
        </SettingsSection>

      </div>

      <details className="group rounded-xl2 border border-line/70 bg-card/70">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <UserRound className="h-4 w-4 text-accent" /> Pawchive account
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-line/60 p-4">
          <AccountPanel />
        </div>
      </details>

      <details className="group rounded-xl2 border border-line/70 bg-card/70">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <Info className="h-4 w-4 text-accent" /> About
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-line/60 p-4">
          <dl className="grid gap-2 text-[11px] text-muted sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt>Version</dt>
              <dd className="text-ink">{config.appVersion}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt>Theme</dt>
              <dd className="text-ink">Pawchive dark</dd>
            </div>
            <div className="sm:col-span-2">
              <dt>API</dt>
              <dd className="truncate text-ink">{config.apiBase}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt>Media host</dt>
              <dd className="truncate text-ink">{config.fileBase}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl2 border border-line/70 bg-card/70 p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}
