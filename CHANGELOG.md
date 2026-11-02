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
