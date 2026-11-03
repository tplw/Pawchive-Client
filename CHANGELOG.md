# Changelog

All notable changes to Pawchive Client are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Android target with the shared mobile shell, bottom tabs, safe-area layout,
  hardware back navigation and ARM64/ARMv7/x86/x86_64 builds.
- Android build helper (`scripts/android.sh`), npm scripts, documentation and
  CI workflow.
- GitHub contribution, code-of-conduct, issue/PR templates, Dependabot and
  release-note configuration.
- Settings toggles are fully clickable and saves are serialized to prevent
  stale responses from overwriting newer changes.

### Changed

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

- Android release builds no longer render a blank WebView by disabling R8
  minification until the keep rules are verified.
- Rapid settings changes no longer roll back or flicker because of out-of-order
  persistence responses.
- Windows finds ffmpeg from `PATH`, Program Files and common install folders,
  and downloaded files avoid reserved DOS device names and trailing dots.

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
