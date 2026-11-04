import { invoke } from "@tauri-apps/api/core";
import type {
  Announcement,
  AccountState,
  AppSettings,
  Comment,
  DownloadRecord,
  CreatorPage,
  CreatorProfile,
  CreatorSummary,
  PawchiveConfig,
  PlaybackProgress,
  Playlist,
  PlaylistItem,
  PlaylistItemInput,
  PostDetail,
  PostPage,
  PostSummary,
  Revision,
  SearchPage,
  UpdateInfo,
} from "../types";

const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(command, args);

// The local media server URL only changes when the app restarts. Reuse the
// token so thumbnails, the player and image viewer do not each pay for a Tauri
// round-trip and create a new token for the same file.
const localMediaUrls = new Map<string, Promise<string>>();

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Tauri invocations cannot be aborted directly. Every cancellable backend
 * command accepts a request id, so aborting the query signal asks the Rust
 * client to cancel the in-flight HTTP request.
 */
async function cancellable<T>(
  signal: AbortSignal | undefined,
  run: (requestId: string) => Promise<T>,
): Promise<T> {
  const requestId = newRequestId();
  const abort = () => {
    void call<boolean>("cancel_request", { requestId }).catch(() => undefined);
  };
  if (signal?.aborted) {
    abort();
    throw new DOMException("The request was cancelled.", "AbortError");
  }
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await run(requestId);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export const api = {
  getSettings: () => call<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) =>
    call<AppSettings>("save_settings", { settings }),
  getConfig: () => call<PawchiveConfig>("get_config"),
  checkForUpdate: () => call<UpdateInfo>("check_for_update"),
  openExternal: (url: string) => call<void>("open_external", { url }),
  setStatusBarHidden: (hidden: boolean) =>
    call<void>("set_status_bar_hidden", { hidden }),

  syncCreators: (signal?: AbortSignal) =>
    cancellable(signal, (requestId) =>
      call<number>("sync_creators", { requestId }),
    ),
  getCreatorCount: () => call<number>("get_creator_count"),
  listCreators: (params: {
    query?: string;
    service?: string;
    sort?: string;
    offset?: number;
    limit?: number;
  }) => call<CreatorPage>("list_creators", params),
  getCreator: (service: string, creatorId: string) =>
    call<CreatorSummary | null>("get_creator", { service, creatorId }),
  getCreatorProfile: (
    service: string,
    creatorId: string,
    signal?: AbortSignal,
  ) =>
    cancellable(signal, (requestId) =>
      call<CreatorProfile>("get_creator_profile", {
        service,
        creatorId,
        requestId,
      }),
    ),
  getCreatorLinks: (
    service: string,
    creatorId: string,
    signal?: AbortSignal,
  ) =>
    cancellable(signal, (requestId) =>
      call<CreatorProfile[]>("get_creator_links", {
        service,
        creatorId,
        requestId,
      }),
    ),
  getCreatorAnnouncements: (
    service: string,
    creatorId: string,
    signal?: AbortSignal,
  ) =>
    cancellable(signal, (requestId) =>
      call<Announcement[]>("get_creator_announcements", {
        service,
        creatorId,
        requestId,
      }),
    ),
  getCreatorPosts: (params: {
    service: string;
    creatorId: string;
    offset?: number;
    signal?: AbortSignal;
  }) =>
    cancellable(params.signal, (requestId) =>
      call<PostPage>("get_creator_posts", {
        service: params.service,
        creatorId: params.creatorId,
        offset: params.offset,
        requestId,
      }),
    ),

  getRecentPosts: (params: { offset?: number; signal?: AbortSignal }) =>
    cancellable(params.signal, (requestId) =>
      call<PostPage>("get_recent_posts", {
        offset: params.offset,
        requestId,
      }),
    ),
  getPopularPosts: (params: { offset?: number; signal?: AbortSignal }) =>
    cancellable(params.signal, (requestId) =>
      call<PostPage>("get_popular_posts", {
        offset: params.offset,
        requestId,
      }),
    ),
  getPostSummary: (params: {
    service: string;
    creatorId: string;
    postId: string;
  }) =>
    call<PostSummary>("get_post_summary", {
      service: params.service,
      creatorId: params.creatorId,
      postId: params.postId,
    }),
  getPost: (params: {
    service: string;
    creatorId: string;
    postId: string;
    signal?: AbortSignal;
  }) =>
    cancellable(params.signal, (requestId) =>
      call<PostDetail>("get_post", {
        service: params.service,
        creatorId: params.creatorId,
        postId: params.postId,
        requestId,
      }),
    ),
  getPostComments: (params: {
    service: string;
    creatorId: string;
    postId: string;
    signal?: AbortSignal;
  }) =>
    cancellable(params.signal, (requestId) =>
      call<Comment[]>("get_post_comments", {
        service: params.service,
        creatorId: params.creatorId,
        postId: params.postId,
        requestId,
      }),
    ),
  getPostRevisions: (params: {
    service: string;
    creatorId: string;
    postId: string;
    signal?: AbortSignal;
  }) =>
    cancellable(params.signal, (requestId) =>
      call<Revision[]>("get_post_revisions", {
        service: params.service,
        creatorId: params.creatorId,
        postId: params.postId,
        requestId,
      }),
    ),
  searchAll: (params: {
    query: string;
    offset?: number;
    service?: string;
    media?: string[];
    sort?: string;
    signal?: AbortSignal;
  }) =>
    cancellable(params.signal, (requestId) =>
      call<SearchPage>("search_all", {
        query: params.query,
        offset: params.offset,
        service: params.service,
        media: params.media,
        sort: params.sort,
        requestId,
      }),
    ),
  cancelRequest: (requestId: string) =>
    call<boolean>("cancel_request", { requestId }),

  listFavoriteCreators: () => call<CreatorSummary[]>("list_favorite_creators"),
  setFavoriteCreator: (params: {
    service: string;
    creatorId: string;
    name: string;
    publicId?: string | null;
    favorited: boolean;
  }) => call<boolean>("set_favorite_creator", params),

  listPlaylists: () => call<Playlist[]>("list_playlists"),
  getPlaylist: (id: number) => call<Playlist>("get_playlist", { id }),
  createPlaylist: (name: string, description?: string) =>
    call<Playlist>("create_playlist", { name, description }),
  renamePlaylist: (id: number, name: string, description?: string) =>
    call<void>("rename_playlist", { id, name, description }),
  deletePlaylist: (id: number) => call<void>("delete_playlist", { id }),
  listPlaylistItems: (playlistId: number) =>
    call<PlaylistItem[]>("list_playlist_items", { playlistId }),
  addPlaylistItem: (playlistId: number, item: PlaylistItemInput) =>
    call<PlaylistItem>("add_playlist_item", { playlistId, ...item }),
  removePlaylistItem: (id: number) =>
    call<void>("remove_playlist_item", { id }),

  startDownload: (request: {
    url: string;
    fileName?: string;
    title?: string;
    creatorName?: string;
    service?: string;
    creatorId?: string;
    postId?: string;
    playlistId?: number | null;
    thumbnailUrl?: string | null;
    mediaKind?: string;
  }) => call<DownloadRecord>("start_download", { request }),
  downloadPost: (service: string, creatorId: string, postId: string) =>
    call<number>("download_post", { service, creatorId, postId }),
  downloadPlaylist: (playlistId: number) =>
    call<number>("download_playlist", { playlistId }),
  cancelDownload: (id: string) => call<void>("cancel_download", { id }),
  deleteDownload: (id: string) => call<void>("delete_download", { id }),
  clearCompletedDownloads: () => call<number>("clear_completed_downloads"),
  clearAllDownloads: () => call<number>("clear_all_downloads"),
  listDownloads: () => call<DownloadRecord[]>("list_downloads"),
  openDownloadsFolder: () => call<void>("open_downloads_folder"),

  getAccountState: () => call<AccountState>("get_account_state"),
  login: (username: string, password: string, remember: boolean) =>
    call<AccountState>("login", { username, password, remember }),
  logout: () => call<AccountState>("logout"),
  syncAccountFavorites: () => call<number>("sync_account_favorites"),

  saveProgress: (progress: PlaybackProgress) =>
    call<void>("save_progress", { progress }),
  getProgress: (filePath: string) =>
    call<PlaybackProgress | null>("get_progress", { filePath }),
  validateMedia: (url: string) => call<string>("validate_media", { url }),
  getMediaSize: (url: string) =>
    call<number | null>("get_media_size", { url }),
  getImageDimensions: (url: string) =>
    call<{ width: number; height: number } | null>("get_image_dimensions", {
      url,
    }),
  getCachedMediaUrl: (url: string) =>
    call<string | null>("get_cached_media_url", { url }),
  cacheMedia: (url: string, requestId?: string) =>
    call<string>("cache_media", { url, requestId }),
  clearMediaCache: () => call<number>("clear_media_cache"),
  canTranscode: () => call<boolean>("can_transcode"),
  transcodeMedia: (url: string, requestId?: string) =>
    call<string>("transcode_media", { url, requestId }),
  localMediaUrl: (path: string) => {
    const cached = localMediaUrls.get(path);
    if (cached) return cached;
    const pending = call<string>("local_media_url", { path });
    localMediaUrls.set(path, pending);
    pending.catch(() => localMediaUrls.delete(path));
    return pending;
  },
  readSubtitle: (path: string) => call<string>("read_subtitle", { path }),
};
