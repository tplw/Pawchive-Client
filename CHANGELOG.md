# Changelog

All notable changes to Pawchive Client are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## 1.0.5.1 - 2026-11-09

Internal rebuild release. The app keeps its existing commands, events, routes,
storage keys, UI and user-facing behavior; release artifacts are rebuilt from
the refactored codebase.

### Changed

- Reorganized the frontend into `app/`, `shared/` and vertical feature slices
  for posts, creators, search, media, player, downloads, playlists, settings,
  account and updates.
- Split the backend Tauri command surface from feature services and moved
  infrastructure into SQLite, API, provider, local HTTP, download and transcode
  modules.
- Broke the largest backend modules into focused submodules for models,
  security, MEGA, GoFile, media serving, downloads, SQLite and API endpoints.
- Added characterization and regression tests around query keys, download
  events, media conversions, pagination, search ranking, playback progress,
  transcoding and image-viewer helpers.
- Removed the temporary page/component compatibility shims and wired router
  navigation explicitly during bootstrap.

### Compatibility

- Existing installations keep their settings, playlists, downloads, playback
  progress, blocked creators, account session and update preferences.
- Bundle metadata uses `1.0.6` internally while the release tag is `v1.0.5.1`.

## Unreleased

### Added

- Media Session transport controls so lock-screen and headphone play/pause,
  previous/next, stop and 10-second seek actions work with the built-in player.
- Desktop browser-style navigation: mouse back/forward buttons, horizontal
  trackpad swipes and Alt/Cmd back/forward shortcuts.
- A mobile top-bar back button and native touch feedback on tabs and cards.
- A play button on post cards that starts the post's audio/video queue without
  opening the post first.
- Post-detail Previous/Next navigation now follows the active creator filters.
- Auto-detected ASMR creators are remembered so their ASMR tag appears on
  creator cards after the profile has been viewed.
- Proton Drive public-link playback, downloads and transcoding, including
  encrypted range streaming and folder-link expansion into individual files.
- Password prompts for protected MEGA and Proton Drive links, including custom
  passwords. The prompt can remember a password on this device; a rejected
  saved password is cleared and the prompt asks for the new one.

- Android target with the shared mobile shell, bottom tabs, safe-area layout,
  hardware back navigation and ARM64/ARMv7/x86/x86_64 builds.
- Android build helper (`scripts/android.sh`), npm scripts, documentation and
  CI workflow.
- GitHub contribution, code-of-conduct, issue/PR templates, Dependabot and
  release-note configuration.
- Settings toggles are fully clickable and saves are serialized to prevent
  stale responses from overwriting newer changes.

### Changed

- Added `proton-drive-rs` for Proton's SRP/OpenPGP public-link handshake and
  range reads. This raises the Rust minimum to 1.96.
- Added `hmac` and `pbkdf2` for MEGA's local password-protected link
  decryption.
- The launch and loading screens now show only the Pawchive paw mark, with no
  text or spinner; Android also uses the paw for its launcher icon.
- Linux `.deb` and `.rpm` packages now recommend the GStreamer plugin sets used
  for media playback; the AppImage continues to bundle them.
- The Search page no longer repeats the archive search heading and description.
- Mobile defaults use small square cards on both iOS and Android.
- Downloads and folder controls adapt to mobile app-private storage.
- Release artifacts are ignored by Git; the Android Gradle project is tracked.
- Android release builds restrict cleartext traffic to the Tauri asset host and
  the loopback media server.

### Fixed

- Player retries now re-run media resolution instead of only reloading an
  already-empty video element.
- Direct archive and external files fall back through the loopback media proxy
  after network or decode errors, adding Range handling and provider headers.
- Remote media proxying rejects expired login pages, mismatched Content-Range
  windows and truncated upstream responses instead of decoding corrupt bytes.
- Media caching refuses partial provider windows and HTML error responses, so a
  broken cache entry cannot cause repeated playback failures.
- Decode failures now show an actionable message instead of the generic
  "media could not be played" text.
- Retrying after a failed transcode attempt resets the transcode guard so the
  fallback can be tried again.

- Android release builds no longer render a blank WebView by disabling R8
  minification until the keep rules are verified.
- Rapid settings changes no longer roll back or flicker because of out-of-order
  persistence responses.
- Windows finds ffmpeg from `PATH`, Program Files and common install folders,
  and downloaded files avoid reserved DOS device names and trailing dots.

## 1.0.5 - 2026-11-08

This release adds MEGA playback and Google Drive, Dropbox and GoFile media
support, provider folder imports, creator blocking and archive availability
indicators, plus a set of content-filter, thumbnail and media-resolution fixes.

### Added

- MEGA playback, downloads and transcoding through the built-in player, with
  decrypted range streaming and provider labels on attachment cards.
- Google Drive, Dropbox and GoFile link support. Provider files are resolved to
  a loopback stream so playback, downloads and transcoding get normal HTTP
  range support.
- Google Drive and MEGA folder links now expand into their individual files.
  MEGA folder support decrypts child node keys and uses the folder-scoped
  download API.
- Provider labels on attachments: Pawchive, MEGA, Google Drive, Dropbox,
  GoFile and External.
- Creator blocking. Profiles have a Block action, Settings shows every blocked
  creator with an Unblock button, and blocked creators are filtered from
  feeds, search, creator lists, linked accounts, playlists, downloads and the
  player queue.
- Archive import and size-limit indicators on creator and post cards, plus a
  **Hide unavailable posts** content filter.
- Per-creator filter controls can now be reset to the global defaults.

### Changed

- **Hide posts without media** now applies to Recent, Popular and Search as
  well as creator feeds. Empty embeds and arbitrary links no longer count as
  media.
- **Hide unavailable posts** keeps posts that still have playable or
  downloadable non-image media. Deferred files, primary media files and cloud
  links count; images do not.
- The main **Hide posts without media** toggle now updates every creator filter
  and is the default for creators without an override.
- Discover Popular now honors all content filters, not only unavailable posts.

### Fixed

- Archive thumbnail URLs now strip the legacy one-character storage prefix, so
  post cards and attachment grids load the correct thumbnail instead of a
  placeholder.
- Attachment previews fall back to the full image when the archive thumbnail is
  missing.
- GoFile resolution handles guest accounts and its rotating website token.
- MEGA folder files download through the correct folder-scoped API, and MEGA
  child keys and attributes are decrypted correctly.
- Existing downloads and playlists hide content from blocked creators without
  deleting any files.
- Rebuilt the 1.0.5 installers with the unavailable-post fix: a bare `deferred`
  attachment with no stored path or signed URL no longer counts as playable or
  downloadable media. Over-limit posts whose only remaining file is an image
  are now hidden by **Hide unavailable posts**.

## 1.0.4 - 2026-11-04

This release adds creator post search, similar-creator discovery and download
retries, plus a broad reliability and security pass across playback, downloads,
media caching, settings and navigation.

### Added

- Per-creator post search on creator profiles, with a 300 ms debounce and a
  three-character minimum. Searches use the archive's `q` parameter and keep
  pagination intact.
- A **Similar Creators** tab that reads the archive's recommendation page and
  enriches the results with locally indexed creator details.
- Retry for failed or cancelled downloads. Retrying reuses the existing record,
  revalidates the media URL and replaces the partially written file.
- Creator names in both player layouts now open the creator profile and collapse
  the expanded player.
- Delete confirmation for individual downloads.
- Focus trapping, background scroll locking and Escape handling for modals and
  the image viewer.

### Changed

- The creator profile Posts tab now uses a compact uppercase `POSTS` heading
  without the redundant title and description.
- Search and creator-directory filters persist when navigating into a post or
  creator and back.
- Download progress events patch the cached download list instead of refetching
  the whole list several times per second.
- Settings autosaves stay serialized and no longer retry indefinitely after a
  failed save.
- Media requests use a public-only DNS resolver, and cache/transcode jobs are
  cancellable with idle timeouts and size limits.
- Download workers finish their file and database cleanup before delete or
  clear-all operations proceed, and filenames are reserved atomically.
- Download counts now report only attachments that were actually queued.

### Fixed

- Resume position could be applied to the previously loaded item when switching
  tracks quickly; progress is now saved and restored against the item the media
  element actually holds.
- Download cancellation, deletion and clear-all could race a running worker or
  remove files outside the download folder.
- Retried downloads could reuse a partially written or already-taken filename.
- Start-up no longer fails when the configured download folder is unavailable.
- Corrupt settings are backed up before falling back to defaults instead of
  being silently discarded.
- Corrupt persisted player queues no longer crash or restore invalid entries.
- Playlist links with id `0` now resolve instead of falling back to Home.
- Retrying a partial playlist add no longer duplicates items or creates the
  same playlist twice.
- Document entries in playlists now open their post (or start a download)
  instead of doing nothing.
- Changing settings no longer restarts the current media source and loses the
  playback position.
- Player keyboard shortcuts only capture keys while the player is expanded.
- Fullscreen state stays in sync when the window is resized, and the image
  viewer cancels abandoned cache requests.
- Future timestamps are no longer shown as "just now", and `shortNumber` no
  longer renders `1000k`.
- Account and favorite-creator failures now show an inline error with a retry
  action.
- SSRF checks now cover IPv4-mapped and IPv4-compatible IPv6, NAT64, legacy
  numeric IPv4, `localhost` subdomains, metadata hosts, CGNAT and reserved
  ranges; DNS rebinding is blocked by the public-only resolver.
- Network errors no longer leak signed media URLs into toasts or download
  records.
- Abandoned cache and transcode temporary files are removed at start-up and the
  cache size limit is enforced.

## 1.0.3.1 - 2026-11-03

### Added

- Streamed/deferred Patreon video attachments now appear in post lists, search
  results and media filters instead of being counted as thumbnails only.
- The mini player shows the live video frame once playback starts, rather than
  keeping the post artwork over it.
- Clicking the mini player thumbnail expands the player.

### Changed

- Clicking the title in the maximized player now minimizes the player and opens
  the original post, matching the minimized player.

### Fixed

- Deferred video attachments now play and download using the archive's signed
  download URL.
- HLS playback falls back to the direct MP4 URL when the webview cannot play
  `.m3u8` streams.
- Playlist entries keep the real downloadable URL instead of storing the HLS
  playlist.
- Transcoding and caching use the direct media URL and skip `.m3u8` playlists.
- Update checks understand four-part release tags such as `v1.0.3.1`.

## 1.0.3 - 2026-11-02

### Added

- Offline playlist playback with local media serving and range support.
- ASMR auto-detection, creator badges, manual ASMR tagging and automatic
  audio-only filtering.
- Fullscreen buffering indicator for audio and video.
- Per-creator audio-only, hidden-keyword and no-media filters.

### Changed

- Media caching no longer runs during streaming, so playback does not compete
  with a background cache download.
- Downloads and cache/transcode transfers use range requests, HTTP/2 adaptive
  windows, TCP no-delay and buffered disk writes for better throughput.
- Transcoding now starts only for unsupported/decode errors.
- Discover combines Recent, Popular and Creators in one control row.
- Search no longer focuses its input automatically.
- The post header stacks actions below the title on phones.
- The minimized player title opens the original post.

### Fixed

- Pressing play after a pause now force-starts playback even if the UI and
  media element state drifted apart.
- Playback retries automatically when the media reaches `canplay`.
- AI post detection uses context-aware markers to reduce false positives.
- Improved creator filter persistence and clearing.

## 1.0.2 - 2026-11-02

### Changed

- Changed the bundle/application identifier to `pw.pawchive.client`. This is a
  separate app identity from the previous `pw.pawchive.desktop` builds, so
  local data does not carry over.
- The installed application is now named **Pawchive**. The project and
  repository remain Pawchive Client.
- Added an **Automatically check for updates** toggle in Settings. When
  enabled, the app checks the latest GitHub release at startup and links to it;
  downloads and installation stay manual.

## 1.0.1 - 2026-11-02

### Changed

- Renamed the product from Pawchive Desktop to Pawchive Client across the UI,
  documentation, installers and mobile builds. The `pw.pawchive.desktop`
  bundle identifier is unchanged so existing installs keep their data and
  update path.
- GitHub releases now include Android APKs and an unsigned iOS IPA alongside
  the desktop installers.

## 1.0.0 - 2026-11-01

### Added

- Native desktop client for the Pawchive archive with Home, Discover, Search,
  creator profiles, posts, playlists, downloads, settings and optional account
  favorites.
- Built-in audio/video player with queue, resume position, speed, subtitles,
  fullscreen and optional desktop ffmpeg transcoding.
- Image viewer with swipe navigation, pinch-to-zoom and fetch progress.
- Per-tab navigation stacks, scroll restoration, local media caching and
  direct media URL support.
- iOS target with the mobile shell and app-private downloads.
