import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  BookOpen,
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
import { SPEEDS, serviceLabel } from "../../../shared/lib/constants";
import { removeBlockedCreator } from "../../../shared/lib/blockedCreators";
import { queryKeys } from "../../../shared/query/keys";
import { isAndroid, isIos, isMobile } from "../../../shared/lib/platform";
import { api } from "../../../shared/api";
import { useAppStore } from "../../../app/store";
import { AccountPanel } from "../../account/ui/AccountPanel";
import { Button, Toggle } from "../../../shared/ui";
import { effectiveMediaFilter } from "../../../shared/lib/creatorFilters";
import type {
  BlockedCreator,
  MediaFilter,
  PostCardSize,
} from "../../../shared/types";

const ACCENT_PRESETS = [
  "#d6aea8",
  "#66d9ff",
  "#b7a4ff",
  "#7ee0c3",
  "#ffd166",
  "#ff8a78",
];

function parseKeywords(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 100);
}

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
  const keywordDirty = useRef(false);
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
    setHideAi(settings.hideAiPosts);
  }, [settings.hideAiPosts]);

  useEffect(() => {
    if (keywordDirty.current) return;
    setKeywordText((settings.hiddenKeywords ?? []).join(", "));
  }, [settings.hiddenKeywords]);

  const invalidateFilters = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.postsAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.searchAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.creatorPostsAll() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.creatorSimilarAll() });
  }, [queryClient]);

  const latest = useRef({
    volume,
    keywordText,
    settings,
    saveSettings,
    invalidateFilters,
  });
  latest.current = {
    volume,
    keywordText,
    settings,
    saveSettings,
    invalidateFilters,
  };

  // Leaving Settings must not discard a debounced edit.
  useEffect(
    () => () => {
      const current = latest.current;
      if (Math.abs(current.volume - current.settings.volume) >= 0.001) {
        void current.saveSettings({ volume: current.volume });
      }
      const keywords = parseKeywords(current.keywordText);
      if (
        JSON.stringify(keywords) !==
        JSON.stringify(current.settings.hiddenKeywords ?? [])
      ) {
        void current
          .saveSettings({ hiddenKeywords: keywords })
          .then(current.invalidateFilters);
      }
    },
    [],
  );

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
      const keywords = parseKeywords(keywordText);
      const serialized = JSON.stringify(keywords);
      if (serialized === JSON.stringify(settings.hiddenKeywords ?? [])) {
        lastKeywordSave.current = null;
        keywordDirty.current = false;
        return;
      }
      if (lastKeywordSave.current === serialized) return;
      lastKeywordSave.current = serialized;
      void saveSettings({ hiddenKeywords: keywords }).then(() => {
        if (
          JSON.stringify(useAppStore.getState().settings.hiddenKeywords ?? []) ===
          serialized
        ) {
          keywordDirty.current = false;
        }
        invalidateFilters();
      });
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
              checked={settings.hideFileTags}
              onChange={(checked) =>
                void saveSettings({ hideFileTags: checked })
              }
              label="Hide file tags"
              description="Hide the media type and file count badges on post cards."
            />
            <Toggle
              compact
              checked={settings.hideSourceTags}
              onChange={(checked) =>
                void saveSettings({ hideSourceTags: checked })
              }
              label="Hide source tags"
              description="Hide service and ASMR badges on cards, profiles and post details."
            />
            <Toggle
              compact
              checked={settings.hidePostPlayButton}
              onChange={(checked) =>
                void saveSettings({ hidePostPlayButton: checked })
              }
              label="Hide post play buttons"
              description="Hide the quick play control on post previews."
            />
            <Toggle
              compact
              checked={settings.reduceMotion}
              onChange={(checked) => void saveSettings({ reduceMotion: checked })}
              label="Reduce motion"
            />
          </div>
        </SettingsSection>

        <div className="md:col-span-2">
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
            <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
              Post media
              <select
                value={effectiveMediaFilter(settings)}
                onChange={(event) => {
                  void saveSettings({
                    mediaFilter: event.target.value as MediaFilter,
                    hideNoMedia: false,
                  }).then(invalidateFilters);
                }}
                className="h-8 w-40 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
              >
                <option value="all">All posts</option>
                <option value="filesAndPictures">Files and pictures</option>
                <option value="filesOnly">Files only</option>
              </select>
            </label>
            <p className="text-[10px] leading-relaxed text-muted">
              Files and pictures hides text-only posts. Files only hides
              text-only and image-only posts. This is the default for every
              creator filter.
            </p>
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
                onChange={(event) => {
                  keywordDirty.current = true;
                  setKeywordText(event.target.value);
                }}
                rows={2}
                placeholder="spoiler, commission, teaser"
                className="w-full resize-y rounded-lg border border-line bg-base px-2.5 py-2 text-xs text-ink outline-none transition placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>
        </SettingsSection>
        </div>

        <div className="md:col-span-2">
          <SettingsSection icon={BookOpen} title="Comic mode">
            <div className="space-y-2">
              <Toggle
                compact
                checked={settings.comicAutoEnable}
                onChange={(checked) =>
                  void saveSettings({ comicAutoEnable: checked })
                }
                label="Auto-enable Comic mode"
                description="Start Comic mode when opening an image from a feed. Creator filters can override this."
              />
              <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
                Images per post
                <select
                  value={settings.comicFirstImageOnly ? "first" : "all"}
                  onChange={(event) =>
                    void saveSettings({
                      comicFirstImageOnly: event.target.value === "first",
                    })
                  }
                  className="h-8 w-40 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
                >
                  <option value="all">All images</option>
                  <option value="first">First image only</option>
                </select>
              </label>
              <p className="text-[10px] leading-relaxed text-muted">
                Default for creator filters. Comic mode applies this when it
                moves into another post.
              </p>
              <label className="flex items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink">
                Prefetch images
                <select
                  value={settings.comicPrefetchCount}
                  onChange={(event) =>
                    void saveSettings({
                      comicPrefetchCount: Number(event.target.value),
                    })
                  }
                  className="h-8 w-40 rounded-lg border border-line bg-base px-2 text-xs text-ink outline-none focus:border-accent/70"
                >
                  <option value={0}>Off</option>
                  {[1, 2, 3, 4, 5].map((count) => (
                    <option key={count} value={count}>
                      {count} image{count === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[10px] leading-relaxed text-muted">
                Preloads this many upcoming images. Near the end of a post,
                the next visible post is loaded ahead. Higher values use more
                network and memory.
              </p>
            </div>
          </SettingsSection>
        </div>

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

      </div>

        <SettingsDetails icon={Ban} title="Blocked creators">
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
        </SettingsDetails>

        <SettingsDetails icon={RefreshCw} title="Updates">
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
        </SettingsDetails>

      <SettingsDetails icon={UserRound} title="Pawchive account">
        <AccountPanel />
      </SettingsDetails>

      <SettingsDetails icon={Info} title="About">
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
      </SettingsDetails>
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

function SettingsDetails({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl2 border border-line/70 bg-card/70">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <Icon className="h-4 w-4 text-accent" /> {title}
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-line/60 p-4">{children}</div>
    </details>
  );
}
