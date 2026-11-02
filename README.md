# Pawchive Desktop

A fast, lightweight, cross-platform desktop and mobile client for the
[Pawchive](https://pawchive.pw) archive, built with Rust, Tauri 2, React and
TypeScript. Native builds are available for macOS, Windows, Linux, iOS and
Android.

Pawchive Desktop focuses on browsing, a reliable built-in audio/video player,
local playlists, downloads and optional account favorites. It is intentionally
not a full archive-management suite.

## Features

- **Playlists** — create local playlists and add audio, video or images from a
  post.
  Playlist covers use the first usable item thumbnail and fall back to the next
  item when one is removed.
- **Queue** — add tracks to the player queue, reorder or remove them.
- **Favorites** — star creators; they appear on Home under your playlists.
- **Downloads** — download a post, a playlist, or a single attachment, with
  automatic retry/backoff for file-host rate limits, plus progress and cancel
  controls. On iOS, completed files appear in **Files → On My iPhone →
  Pawchive Desktop → Downloads**; on Android they are stored in app-private
  storage. Downloaded playlist items play from local storage and are marked
  **Offline**. Downloads show image, video-frame or post
  thumbnails, play locally when clicked, and can all be added to a playlist at
  once. Local playback uses cached loopback URLs and HTTP cache validators for
  faster starts and seeking.
- **Optional Pawchive login** — sign in to sync favorite creators with your
  Pawchive account, with an optional automatic sync at app start. Local
  playlists and downloads work without an account.
- **Discover** — Popular is the default feed, with Recent and Creators tabs,
  a service filter, pagination and lazy thumbnails.
- **Search creators and posts together** with a debounced query, service
  filters, media-type filters, sorting and pagination. Popular cards are
  enriched with their real media-type tags when they enter view.
- **Creator directory** indexed locally once for instant offline search,
  service filtering and popularity/updated sorting.
- **Creator profiles** with description (when the archive provides one),
  linked accounts, announcements and archived posts.
- **Post viewer** with sanitized descriptions, organised attachments, comments
  and revisions.
- **Built-in audio/video player** with a persistent bottom mini-player, a
  full-screen view with controls at the bottom, seek, volume, mute, speed,
  fullscreen, subtitles, previous/next attachment, queue, buffering/error
  states and resume position. Watch progress is saved on pause, route changes
  and app background. On desktop with ffmpeg installed, unsupported media can
  be transcoded automatically with live progress.
- **Image viewer** with a full-screen portal, swipe/previous/next navigation,
  pinch-to-zoom, panning and per-image fetch progress.
- **Pawchive-style interface** using the site's dark palette, Helvetica
  typography, compact shapes and menu icons, plus the site paw logo as the app
  icon.
- **Virtualized grids**, lazy images, API response caching, request
  cancellation, bounded concurrency, connection reuse and streaming media.
- **Secure defaults**: HTTPS-only remote requests, Pawchive host allowlisting
  for the archive API, sanitized remote HTML, a strict Content Security Policy
  and a minimal Tauri capability set. Public HTTPS media providers are
  supported while local and private hosts are rejected; Android permits
  cleartext only for the Tauri asset host and loopback media server.

## Non-goals

To keep the app focused, it does **not** include:

- account registration, credential harvesting or third-party API credentials;
- bundling a separate media engine (optional desktop transcoding uses a
  system ffmpeg installation);
- editing, uploading, importing or posting to the archive;
- a full archive-management suite (collections, view history, tagging, etc.).

## Technology

| Layer    | Stack |
| -------- | ----- |
| Backend  | Rust stable, Tauri 2, Tokio, Reqwest, Serde, Rusqlite |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Lucide, TanStack Query, Zustand |
| Storage  | SQLite (settings, local creator index, playback progress) |

## Requirements

- Rust stable (the crate declares Rust 1.77.2 as its minimum).
- Node.js 20+ and npm.
- Platform prerequisites for Tauri 2:
  - **macOS**: Xcode command line tools.
  - **Windows**: WebView2 (included with Windows 10/11) and the Microsoft
    C++ build tools.
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
    `librsvg2-dev`, `patchelf` and a C compiler. For runtime playback install
    the GStreamer “good/bad/ugly” plugin sets.
  - **iOS**: macOS with Xcode 15+ and CocoaPods. See
    [docs/IOS.md](docs/IOS.md).
  - **Android**: JDK 17, Android SDK Platform 36, Build-Tools 36.0.0, NDK
    `27.0.12077973` and the Rust Android targets. See
    [docs/ANDROID.md](docs/ANDROID.md).

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
distribution-specific package names.

## Getting started

```bash
npm install
npm run tauri dev
```

The first launch downloads the creator directory once (about 15 MB) in the
background. The app remains usable while the index is built. The index is
stored locally and is reused on later launches.

### Quality checks

```bash
# Frontend
npm run typecheck
npm run lint
npm run test
npm run build

# Rust backend
cd src-tauri
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Production build

```bash
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`. Release
artifacts for local testing are kept in `artifacts/` (ignored by Git).
`src-tauri/target/` and the iOS/Android generated build folders are disposable
caches and can be removed to reclaim disk space. See
[docs/PACKAGING.md](docs/PACKAGING.md) for platform details and signing.

### iOS

The iOS Xcode project is generated at `src-tauri/gen/apple`. With Xcode
installed, run:

```bash
npm run ios
```

See [docs/IOS.md](docs/IOS.md) for simulator/device setup, signing and
platform-specific notes.

### Android

The Gradle project is tracked at `src-tauri/gen/android`. After installing the
SDK packages listed in [docs/ANDROID.md](docs/ANDROID.md):

```bash
npm run android:doctor      # check Java, SDK, NDK, devices and AVDs
npm run android:emulator    # start the first available AVD
npm run android:dev         # run with hot reload
npm run android:build       # release APKs split per ABI
```

Release APKs are unsigned; sign them with `apksigner` before sideloading.
See [docs/ANDROID.md](docs/ANDROID.md) for emulator creation, device installs,
signing, CI and current Android limitations.

## Using the app

- **Home** — your playlists and favorite creators. Create playlists, play or
  download them.
- **Discover** — opens on **Popular**; switch to Recent or Creators, filter
  posts and creators by service, and sort creators by popularity, update time
  or name.
- **Search** — unified post/creator search. Use the content filter to show all,
  posts only or creators only; media chips filter posts by attachment type.
- **Creator profile** — favorite button, per-creator filters (audio-only,
  no-media and hidden keywords), posts, about/links and announcements.
- **Post viewer** — description, full-screen swipeable image gallery,
  audio/video attachments, documents, comments and revisions. Attachments can
  be played, queued, added to a playlist or downloaded; “Download post” queues
  every downloadable attachment and skips preview-only files that are not on
  the file host. Direct media links and archive `temp_url` files are supported,
  attachment rows show resolution/file size, and links open in the system
  browser.
- **Playlist** — tap an item to play audio/video or open an image full-screen.
  Play all, queue all, download all, remove items or delete the playlist.
- **Downloads** — live progress, local thumbnails, play downloaded media,
  add all completed downloads to a playlist, cancel, delete records, open the
  download folder or clear entries.
- **Settings** — playback defaults, autoplay/resume, card size (Medium on
  desktop, Small on iOS and Android), accent color, reduced motion, hidden
  keywords, AI and no-media filters, download folder, API/media cache limits,
  optional media caching, optional ffmpeg transcoding, infinite-scroll
  load-ahead and optional Pawchive login with automatic favorite sync. Small
  post and playlist cards are square 1:1 tiles.
- **Player** — click any audio or video attachment. The bottom bar persists
  while you navigate and includes a queue button for quick access to the
  current queue. Expand for the full-screen player with a bottom control
  overlay, speed cycling and a dismissible queue sheet. Controls auto-hide
  after four seconds only in landscape fullscreen; tap the video to show or
  hide them. `X` minimizes playback without stopping it; `F` toggles
  fullscreen, space plays/pauses and the arrow keys seek or change volume.
  Images never enter the player queue.
- **Tab navigation** — Home, Discover, Search, Downloads and Settings each
  keep their own navigation stack and scroll position. For example, opening a
  creator and post from Home, switching to Discover and returning to Home
  restores the post. Back and edge-swipe navigation stay inside the active tab
  and never jump to another tab's page. On Android the system back button
  dismisses overlays and the player, walks back through the active tab, returns
  to Home from another tab, and closes the app at the Home root.
- **Image viewer** — click an image; swipe or use the arrow keys for the next
  image, `+`/`-` and `0` to zoom/reset, and `Esc` to close. In landscape
  fullscreen the viewer hides its UI after four seconds, matching the video
  player; tap the image to bring it back.

Keyboard shortcuts (desktop): `⌘/Ctrl+1` Home, `⌘/Ctrl+2` Discover,
`⌘/Ctrl+3` Search, `⌘/Ctrl+4` Downloads, `⌘/Ctrl+5` Settings, `⌘/Ctrl+,`
Settings, `⌘/Ctrl+K` focus search.

## API

The app uses only the documented Pawchive API at
`https://pawchive.pw/api/v1`. The saved OpenAPI document is in
[`docs/pawchive_openapi.json`](docs/pawchive_openapi.json).

Endpoints used:

- `GET /posts` — recent posts and post search (`q`, `o`).
- `GET /creators` — full creator directory, downloaded once into SQLite.
- `GET /{service}/user/{id}` — creator posts with offset pagination.
- `GET /{service}/user/{id}/profile` — creator profile.
- `GET /{service}/user/{id}/links` — linked accounts.
- `GET /{service}/user/{id}/announcements` — public announcements.
- `GET /{service}/user/{id}/post/{post_id}` — post detail.
- `GET /{service}/user/{id}/post/{post_id}/comments` — comments.
- `GET /{service}/user/{id}/post/{post_id}/revisions` — revisions.
- `POST /account/login` — optional site login (form), session cookie kept in
  the Rust backend.
- `GET /account/favorites` — optional account favorite creators.
- `POST/DELETE /favorites/creator/{service}/{id}` — optional account favorite
  sync.
- The **Popular** feed is parsed from the official server-rendered
  `/posts/popular` page because the JSON API does not expose a popularity
  endpoint.

Pagination offsets are sent in multiples of 50, as required by the archive.
Search queries are validated to 3–200 characters. The app does not invent
endpoints. No credentials are sent unless you explicitly sign in; the account
session is used only for account/favorite endpoints.

Use the app in accordance with Pawchive's terms and the rights of the creators
whose work is archived. The client only displays content the archive already
serves publicly; it does not bypass access controls or redistribute files.

## Local data

The SQLite database is stored in the platform application-data directory:

- macOS: `~/Library/Application Support/pw.pawchive.desktop/pawchive.sqlite3`
- Windows: `%APPDATA%\pw.pawchive.desktop\pawchive.sqlite3`
- Linux: `~/.local/share/pw.pawchive.desktop/pawchive.sqlite3`
- iOS/Android: the app's private application-data directory

Tables:

- `settings` — sidebar state, volume, playback speed and download folder.
- `creators` — local creator directory for fast search.
- `favorite_creators` — locally starred creators.
- `playlists` / `playlist_items` — local media playlists.
- `downloads` — download records and progress.
- `playback_progress` — last position/duration per media file.

Optional account session: `account.json` in the same application-data folder,
created only when “Remember me” is enabled. On desktop, downloaded files are
written to the folder chosen in Settings (default: the application-data
downloads folder); on mobile they stay in app-private storage. There is no
telemetry.

## Media support

Playback uses the platform webview's native media engine; the app streams from
the Pawchive file host and relies on HTTP Range support for seeking. Codec
support therefore depends on the operating system:

| Platform | Typical support | Notes |
| -------- | --------------- | ----- |
| macOS (WKWebView) | MP4/H.264, MOV, WebM (VP8/VP9 on recent macOS), MP3, AAC, FLAC, WAV | MKV and AVI are not reliably supported. |
| Windows (WebView2) | MP4/H.264, WebM/VP8-9, MP3, AAC, FLAC, WAV, OGG, Opus | MKV depends on the installed WebView2 codec set. |
| Linux (WebKitGTK) | Depends on installed GStreamer plugins | The AppImage bundles a media framework; `.deb` users should install the GStreamer plugin sets. |
| iOS (WKWebView) | Same as macOS | MKV/AVI are not guaranteed. |
| Android (System WebView) | MP4/H.264, WebM/VP8-9, MP3, AAC, FLAC, Opus (device-dependent) | Codec support follows the installed System WebView. |

Unsupported containers are reported in the player instead of being advertised
as playable. If a file cannot be decoded, use a dedicated media player. The
engine choice and licensing trade-offs are documented in
[docs/PLAYER.md](docs/PLAYER.md).

## Project structure

```text
src/                  React interface
  assets/             Pawchive menu icons and paw brand mark
  components/         reusable UI, cards, grids, pickers, image viewer
  pages/              Home, Discover, Creators, creator, post, search,
                      playlist, downloads, settings
  player/             persistent media player and queue store
  services/           typed Tauri command wrappers
  hooks/              debounce and other UI hooks
  styles/             Tailwind entry and global styles
src-tauri/            Rust/Tauri backend
  src/api/            HTTP client, retries, cache, endpoints
  src/models.rs       API and UI data models
  src/db.rs           SQLite persistence
  src/media.rs        media URL validation and subtitles
  src/security.rs     URL, path and HTML sanitization
  migrations/         SQLite schema
src-tauri/gen/apple/  generated Xcode project (tracked)
src-tauri/gen/android/ generated Gradle project (tracked)
scripts/              iOS and Android build helpers
docs/                 OpenAPI, Android, iOS, performance and packaging notes
```

## Performance

The app is designed to stay responsive on large pages:

- Virtualized post and creator grids render only visible rows.
- Downloads stream in the Rust backend and emit progress events; they never
  load whole files into memory.
- Infinite pagination uses the archive's 50-item offsets.
- API responses are cached in memory with a bounded size and TTL.
- In-flight HTTP requests can be cancelled when a React Query is aborted.
- Search is debounced and uses a single unified request.
- Thumbnails are lazy-loaded and cached by the webview's HTTP cache
  (`Cache-Control: public, max-age=...` from the image host).
- Media is streamed by the webview; files are never loaded into memory by the
  Rust backend.
- Rust work that touches SQLite runs on blocking worker threads.

See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for measurement instructions and
the release checklist.

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately; do not open a
public issue.

## Contributing

Bug reports and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported
privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
