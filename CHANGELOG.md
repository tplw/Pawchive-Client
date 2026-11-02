# Changelog

All notable changes to Pawchive Desktop are documented here. The format is
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
