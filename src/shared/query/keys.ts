/**
 * Central query-key factories. The arrays are intentionally identical to the
 * literals they replace so existing cache and invalidation behavior does not
 * change during the refactor.
 */
export const queryKeys = {
  account: () => ["account"] as const,
  canTranscode: () => ["can-transcode"] as const,
  downloads: () => ["downloads"] as const,
  playlists: () => ["playlists"] as const,
  playlist: (playlistId: number) => ["playlist", playlistId] as const,
  playlistItems: (playlistId?: number) =>
    playlistId == null
      ? (["playlist-items"] as const)
      : (["playlist-items", playlistId] as const),
  posts: () => ["posts"] as const,
  postsAll: () => ["posts"] as const,
  postsDiscover: () => ["posts", "discover"] as const,
  postsPopular: () => ["posts", "popular"] as const,
  post: (service: string, creatorId: string, postId: string) =>
    ["post", service, creatorId, postId] as const,
  postAll: () => ["post"] as const,
  postAttachments: (
    service: string,
    creatorId: string,
    postId: string,
    signature: string,
  ) => ["post-attachments", service, creatorId, postId, signature] as const,
  postSummary: (service: string, creatorId: string, postId: string) =>
    ["post-summary", service, creatorId, postId] as const,
  comments: (service: string, creatorId: string, postId: string) =>
    ["comments", service, creatorId, postId] as const,
  revisions: (service: string, creatorId: string, postId: string) =>
    ["revisions", service, creatorId, postId] as const,
  creator: (service: string, creatorId: string) =>
    ["creator", service, creatorId] as const,
  creatorAll: () => ["creator"] as const,
  creatorProfile: (service: string, creatorId: string) =>
    ["creator-profile", service, creatorId] as const,
  creatorLinks: (service: string, creatorId: string) =>
    ["creator-links", service, creatorId] as const,
  creatorAnnouncements: (service: string, creatorId: string) =>
    ["creator-announcements", service, creatorId] as const,
  creatorSimilar: (service: string, creatorId: string) =>
    ["creator-similar", service, creatorId] as const,
  creatorSimilarAll: () => ["creator-similar"] as const,
  creatorPosts: (service: string, creatorId: string, query: string) =>
    ["creator-posts", service, creatorId, query] as const,
  creatorPostsAll: () => ["creator-posts"] as const,
  creators: () => ["creators"] as const,
  creatorsDiscover: (service: string, sort: string) =>
    ["creators", "discover", service, sort] as const,
  creatorsDirectory: (query: string, service: string, sort: string) =>
    ["creators", "directory", query, service, sort] as const,
  creatorsSearch: (query: string, service: string, sort: string) =>
    ["creators", "search", query, service, sort] as const,
  favoritesCreators: () => ["favorites", "creators"] as const,
  search: (query: string, service: string, media: readonly string[], sort: string) =>
    ["search", query, service, media, sort] as const,
  searchAll: () => ["search"] as const,
} as const;
