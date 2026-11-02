# Pawchive Desktop

[![CI](https://github.com/tplw/Pawchive-Client/actions/workflows/ci.yml/badge.svg)](https://github.com/tplw/Pawchive-Client/actions/workflows/ci.yml)
[![Android](https://github.com/tplw/Pawchive-Client/actions/workflows/android.yml/badge.svg)](https://github.com/tplw/Pawchive-Client/actions/workflows/android.yml)

A fast, local-first client for the [Pawchive](https://pawchive.pw) archive,
built with Rust, Tauri 2, React and TypeScript. Runs on macOS, Windows, Linux,
iOS and Android.

Browse and search creators and posts, play audio and video, organize local
playlists, download media for offline use and optionally sync favorite creators
with a Pawchive account. No telemetry, no ads, no account required.

## Download

Prebuilt desktop and mobile builds are available on the
[Releases](https://github.com/tplw/Pawchive-Client/releases) page. Android APKs
are debug-signed for testing and sideloading; the iOS IPA is unsigned and must
be signed with your Apple ID/team before installation.

## Features

- **Discover & search** — Popular, Recent and Creators feeds, unified
  post/creator search, filters, sorting and a locally indexed creator
  directory for instant search.
- **Built-in player** — persistent mini-player, queue, speed control, subtitles,
  fullscreen, resume position and optional desktop ffmpeg transcoding.
- **Image viewer** — full-screen gallery with swipe navigation and pinch-to-zoom.
- **Playlists & favorites** — local playlists for audio, video and images, plus
  starred creators on Home.
- **Offline downloads** — download posts, playlists or single attachments with
  progress, retry and cancel controls.
- **Optional account** — sign in to sync favorite creators; the session stays in
  the Rust backend.
- **Native mobile shell** — bottom tab navigation, safe areas, Android hardware
  back handling and app-private downloads.
- **Secure defaults** — HTTPS-only remote requests, host allowlisting,
  sanitized HTML, a strict CSP and a minimal Tauri capability set.

## Technology

| Layer    | Stack |
| -------- | ----- |
| Backend  | Rust, Tauri 2, Tokio, Reqwest, Serde, Rusqlite |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand |
| Storage  | SQLite |

## Requirements

- Node.js 20.19+ (or 22.12+) and npm.
- Rust stable (minimum 1.90).
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/):
  - **macOS**: Xcode command line tools.
  - **Windows**: WebView2 and the Microsoft C++ build tools.
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`,
    `librsvg2-dev`, `patchelf` and a C compiler. Install the GStreamer
    good/bad/ugly plugin sets for media playback.
  - **iOS**: macOS with Xcode 15+ and CocoaPods. See [docs/IOS.md](docs/IOS.md).
  - **Android**: JDK 17, Android SDK 36, NDK `27.0.12077973` and the Rust
    Android targets. See [docs/ANDROID.md](docs/ANDROID.md).

## Getting started

```bash
npm install
npm run tauri dev
```

The creator index (about 15 MB) downloads once in the background on first
launch and is reused afterwards.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build

cd src-tauri
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Builds

### Desktop

```bash
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`.

### Android

```bash
npm run android:doctor    # check Java, SDK, NDK, devices and emulators
npm run android:emulator  # start the first available AVD
npm run android:dev       # run with hot reload
npm run android:build     # release APKs split per ABI
npm run android:bundle    # release App Bundle (.aab)
```

Release APKs are unsigned; sign them with `apksigner` before distribution.
See [docs/ANDROID.md](docs/ANDROID.md) for setup, signing and known limitations.

### iOS

```bash
npm run ios         # build and run on a simulator
npm run ios:build   # build an archive for Xcode export
```

See [docs/IOS.md](docs/IOS.md) for signing, device setup and unsigned IPA
export.

Build output and caches can be removed with `npm run clean`; `node_modules` and
`artifacts` are kept.

## Project structure

```text
src/                  React interface
  components/         reusable UI, cards, grids, viewer
  pages/              Home, Discover, Search, creator, post, downloads, settings
  player/             persistent media player and queue
  services/           typed Tauri command wrappers
src-tauri/            Rust/Tauri backend
  src/api/            HTTP client, retries, cache, endpoints
  src/db.rs           SQLite persistence
  src/media.rs        media validation and subtitles
  migrations/         SQLite schema
src-tauri/gen/        tracked Xcode and Gradle projects
scripts/              iOS and Android build helpers
docs/                 platform, packaging, player and performance notes
```

## Documentation

- [Android setup and limitations](docs/ANDROID.md)
- [iOS setup and signing](docs/IOS.md)
- [Packaging and release details](docs/PACKAGING.md)
- [Player engine notes](docs/PLAYER.md)
- [Performance notes](docs/PERFORMANCE.md)
- [Pawchive API specification](docs/pawchive_openapi.json)
- [Changelog](CHANGELOG.md)

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Please do not open a public issue for security problems.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
