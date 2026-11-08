export type MediaKind = "image" | "video" | "audio" | "document" | "other";
export type MediaProvider =
  | "pawchive"
  | "mega"
  | "googleDrive"
  | "dropbox"
  | "gofile"
  | "external";
export type Service = "patreon" | "fanbox" | "discord" | string;

export interface FileRef {
  name: string;
  path: string;
  preview_only?: boolean | null;
  node?: number | null;
  [key: string]: unknown;
}

export interface ApiPost {
  id: string;
  user: string;
  service: Service;
  title: string;
  content: string;
  embed: unknown;
  shared_file: boolean;
  added: number | null;
  published: number | null;
  edited: number | null;
  file: FileRef | null;
  attachments: FileRef[];
  substring?: string | null;
  preview_state?: string | null;
  has_full?: boolean | null;
  origin?: string | null;
  next?: string | null;
  prev?: string | null;
  poll?: unknown;
  captions?: unknown;
  [key: string]: unknown;
}

export interface CreatorSummary {
  id: string;
  name: string;
  service: Service;
  public_id?: string | null;
  indexed?: number | null;
  updated?: number | null;
  favorited?: number | null;
  is_favorite?: boolean;
  /** False when the archive has indexed the creator but never imported posts. */
  ever_imported?: boolean | null;
}

export interface CreatorProfile extends CreatorSummary {
  relation_id?: string | null;
  description?: string | null;
  banner?: string | null;
}

export interface Attachment {
  name: string;
  path: string;
  url: string;
  downloadUrl?: string | null;
  thumbnailUrl: string | null;
  kind: MediaKind;
  provider: MediaProvider;
  ext: string;
  previewOnly: boolean;
}

export interface MegaMedia {
  /** Loopback URL that streams the decrypted MEGA file. */
  url: string;
  name: string;
  size: number;
  kind: MediaKind;
}

export interface PostSummary {
  id: string;
  service: Service;
  user: string;
  creatorName: string | null;
  title: string;
  excerpt: string;
  published: number | null;
  added: number | null;
  thumbnailUrl: string | null;
  attachmentCount: number;
  mediaKinds: MediaKind[];
  previewState: string | null;
  hasFull: boolean | null;
  /** False for Kemono previews the archive has not imported yet. */
  imported: boolean;
  /** True when imported files were dropped for exceeding the archive limit. */
  exceedsLimit: boolean;
  /** True when the unavailable-post filter should hide this post. */
  unavailable: boolean;
}

export interface PostDetail {
  post: ApiPost;
  attachments: Attachment[];
  creator: CreatorSummary | null;
  next: string | null;
  prev: string | null;
}

export interface PostPage {
  items: PostSummary[];
  offset: number;
  hasMore: boolean;
}

export interface CreatorPage {
  items: CreatorSummary[];
  offset: number;
  total: number;
  hasMore: boolean;
  synced: boolean;
}

export interface SearchPage {
  posts: PostSummary[];
  creators: CreatorSummary[];
  offset: number;
  hasMore: boolean;
  query: string;
  limitations: string[];
}

export interface CommentRevision {
  id: number;
  content: string;
  added: number | null;
}

export interface Comment {
  id: string;
  parent_id: string | null;
  commenter: string;
  commenter_name: string | null;
  content: string;
  published: number | null;
  revisions: CommentRevision[];
  [key: string]: unknown;
}

export interface Revision {
  revision_id: number;
  [key: string]: unknown;
}

export interface Announcement {
  service: Service;
  user_id: string;
  hash: string;
  content: string;
  added: number | null;
}

export interface PlaybackProgress {
  filePath: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export type PostCardSize = "small" | "medium" | "large";

export interface AppSettings {
  sidebarVisible: boolean;
  volume: number;
  playbackSpeed: number;
  downloadDir: string;
  hiddenKeywords: string[];
  hideAiPosts: boolean;
  postCardSize: PostCardSize;
  autoplayNext: boolean;
  resumePlayback: boolean;
  reduceMotion: boolean;
  accentColor: string;
  hideNoMedia: boolean;
  hideUnavailablePosts: boolean;
  autoDetectAsmr: boolean;
  autoSyncFavorites: boolean;
  cacheSizeMb: number;
  mediaCacheSizeMb: number;
  cacheMedia: boolean;
  transcodeMedia: boolean;
  loadAheadPages: number;
  showCreatorUpdated: boolean;
  autoCheckUpdates: boolean;
  /** Release version the user dismissed; newer versions show the prompt again. */
  dismissedUpdateVersion: string;
}

export interface PawchiveConfig {
  apiBase: string;
  staticBase: string;
  imageBase: string;
  fileBase: string;
  appName: string;
  appVersion: string;
  userAgent: string;
  defaultTimeoutSecs: number;
  defaultConcurrency: number;
  defaultRetries: number;
  cacheTtlSecs: number;
  pageSize: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  url: string;
  releaseName: string | null;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  itemCount: number;
  coverUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistItem {
  id: number;
  playlistId: number;
  service: Service;
  creatorId: string;
  postId: string;
  mediaPath: string;
  mediaUrl: string;
  title: string;
  creatorName: string;
  thumbnailUrl: string | null;
  mediaKind: MediaKind;
  addedAt: number;
  localPath?: string | null;
}

export interface PlaylistItemInput {
  service: Service;
  creatorId: string;
  postId: string;
  mediaPath: string;
  mediaUrl: string;
  title: string;
  creatorName: string;
  thumbnailUrl: string | null;
  mediaKind: MediaKind;
}

export interface DownloadRecord {
  id: string;
  url: string;
  filePath: string;
  fileName: string;
  mediaKind: MediaKind;
  title: string;
  creatorName: string;
  service: Service;
  creatorId: string;
  postId: string;
  playlistId: number | null;
  thumbnailUrl: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  status: "queued" | "downloading" | "completed" | "failed" | "cancelled";
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AccountState {
  loggedIn: boolean;
  username: string | null;
}

export interface QueueItem {
  id: string;
  url: string;
  downloadUrl?: string | null;
  localPath?: string | null;
  filePath: string;
  fileName: string;
  mediaKind: MediaKind;
  title: string;
  creatorName: string;
  artwork: string | null;
  service: Service;
  creatorId: string;
  postId: string;
}

export type PageName =
  | "home"
  | "discover"
  | "creators"
  | "creator"
  | "post"
  | "search"
  | "playlist"
  | "downloads"
  | "settings";

export type TabName = "home" | "discover" | "search" | "downloads" | "settings";

export interface Route {
  name: PageName;
  service?: string;
  creatorId?: string;
  postId?: string;
  query?: string;
  playlistId?: number;
}

export interface AppErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}
