# Rebuild Contract Inventory

Phase 0 of the rebuild freezes these contracts. They must not change while code
moves between modules.

## Tauri commands (63)

Settings/system: `get_settings`, `save_settings`, `get_config`,
`check_for_update`, `open_external`, `set_status_bar_hidden`.

Creators: `sync_creators`, `get_creator_count`, `get_creator_index_status`,
`list_creators`, `get_creator`, `get_creator_profile`, `get_creator_links`,
`get_creator_announcements`, `get_creator_posts`,
`get_creator_download_posts`, `get_similar_creators`.

Posts/search: `get_recent_posts`, `get_popular_posts`, `get_post_summary`,
`get_post`, `get_post_comments`, `get_post_revisions`, `search_all`,
`cancel_request`.

Favorites: `list_favorite_creators`, `set_favorite_creator`.

Playlists: `list_playlists`, `get_playlist`, `create_playlist`, `rename_playlist`,
`delete_playlist`, `list_playlist_items`, `add_playlist_item`,
`remove_playlist_item`.

Downloads: `start_download`, `download_post`, `download_playlist`,
`download_creator_posts`, `cancel_download`, `delete_download`, `retry_download`,
`clear_completed_downloads`, `clear_all_downloads`, `list_downloads`,
`open_downloads_folder`.

Account: `login`, `get_account_state`, `logout`, `sync_account_favorites`.

Playback/progress: `save_progress`, `get_progress`.

Media: `validate_media`, `resolve_media`, `get_media_size`,
`get_image_dimensions`, `get_cached_media_url`, `cache_media`,
`clear_media_cache`, `can_transcode`, `transcode_media`, `local_media_url`,
`read_subtitle`.

Command function names, parameter names, camelCase DTO fields and `AppError`
codes/messages/retryability stay unchanged.

## Tauri events

- `download://progress`
- `download://complete`
- `download://error`
- `transcode://progress`
- `media-cache://progress`
- `creators://synced`

Event names and payload field names stay unchanged.

## Routes and navigation

- `#/home`
- `#/discover`
- `#/creators` (optional `q`)
- `#/creator/:service/:creatorId`
- `#/post/:service/:creatorId/:postId`
- `#/search` (optional query state)
- `#/playlist/:playlistId`
- `#/downloads`
- `#/settings`

Preserve hash parsing/serialization, tab stacks, `previousRoute`, keyed post
remounts, the fixed search route key and scroll restoration.

## Browser storage

- `localStorage["pawchive-player"]` — persisted queue and current id only.
  Items before the current item are dropped when saving and hydrating.
- `localStorage["pawchive-creator-filter:<service>:<creatorId>"]` — per-creator
  filter overrides.
- `localStorage["pawchive-creator-download-schedules"]` — recurring creator
  download schedules.
- `sessionStorage["pawchive-creator-tab:<service>:<creatorId>"]` — selected
  creator profile tab.
- `sessionStorage["pawchive-scroll-positions"]` — per-route scroll offsets.

Changing any shape requires an explicit migration.

## DOM and CSS contracts

- `#main-scroll`
- `[data-modal-open="true"]`
- `pawchive:save-progress`, `pawchive:seek`, `pawchive:scroll-top`,
  `pawchive:close-queue`, `pawchive:focus-search` window events.
- `.app-shell`, `.main-scroll`, `.content-row`, `.player-bar`,
  `data-card-size`, `data-tauri-drag-region`.

## Media and persistence contracts

- Provider order: MEGA, then Google Drive/Dropbox/GoFile, then direct Pawchive
  URLs.
- Deferred attachments without a path or signed URL are not real media.
- Provider folders expand into individual file attachments.
- Loopback media URLs support HTTP Range, HEAD, ETag and provider headers.
- Cache directory: `app_data/media-cache`; hashed filenames, atomic `.part-*`
  writes, size pruning.
- Downloads: global concurrency gate, unique destination reservation,
  cancellation tokens and partial-file cleanup.
- `Attachment.localPath` is an optional completed local download. Post detail
  fills it from the downloads table; matching attachments skip provider
  resolution and use the local file for images and playback. Post downloads
  skip files that already have a completed record.
- Creator batch downloads scan the unfiltered creator feed so global feed
  filters cannot hide posts, then apply the dialog's own filters and
  media-kind selection.
- Creator batch downloads apply media-kind filters and skip existing, locked and
  preview-only files. Existing means a download record or a file with the same
  sanitized name in the creator folder.
- `get_creator_posts` accepts `sort: "newest" | "oldest"`. Oldest uses offset
  `-1` for the first request, probes the newest-first feed for its last page,
  and returns 50-post pages backwards. The frontend keeps the order and stops at
  offset 0.
- Creator batch downloads save under a sanitized creator-name subfolder.
  Retries keep that folder, and list repair checks the same folder name when
  the mobile app container moves.
- Creator download schedules are stored in localStorage, run while the app is
  open, and are managed from the Schedules button beside Choose creator.
  Each schedule's settings can change its time, media types, limits, keywords
  and skip-existing behavior.
- Clearing completed or all downloads removes database records; completed
  media files stay on disk. Only partial files from non-completed records are
  removed.
- DB writes stay on `spawn_blocking`; migrations are append-only.
- Pagination remains 50 posts / 60 creators until a deliberate behavior change.
