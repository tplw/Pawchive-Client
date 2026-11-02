# Security Policy

## Supported versions

Pawchive Client is a local-first desktop and mobile client. Security fixes
are provided for the latest released minor version.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately
through the repository's **Security → Report a vulnerability** flow (GitHub
private vulnerability reporting). Include:

- the Pawchive Client version and operating system;
- a description of the issue and its impact;
- reproduction steps or a proof of concept;
- relevant logs with personal data removed.

You can expect an acknowledgement within 72 hours and a status update within
seven days. Please allow a reasonable disclosure window before publishing
details.

## Scope

In scope:

- the Rust/Tauri backend and its Tauri commands;
- the React frontend, desktop shell and mobile shell;
- URL validation, redirect handling, HTML sanitization and media URL checks;
- subtitle file handling and path validation;
- download handling, safe filenames and download-folder containment;
- optional account login, session storage and favorite syncing;
- the Tauri capability configuration, Android/iOS project and Content
  Security Policy;
- packaging and release configuration in this repository.

Out of scope:

- the availability, content or moderation of the Pawchive archive itself;
- vulnerabilities in webview engines, operating systems or upstream
  dependencies without an exploitable impact in this app;
- social engineering or physical access to an unlocked device;
- containers/codecs the system webview cannot decode.

## Security model

### Network access

- All remote requests are made by the Rust backend over HTTPS. Plain HTTP and
  URLs containing credentials are rejected. The only HTTP listener is the
  loopback media server used for downloaded files. On Android, a release
  network security config permits cleartext only for `127.0.0.1`, `localhost`,
  `tauri.localhost` and `ipc.localhost`; all remote requests remain HTTPS.
- Archive requests are restricted to the configured Pawchive hosts
  (`pawchive.pw`, `img.pawchive.pw`, `file.pawchive.pw`). A URL is parsed and
  its host compared with the allowlist before a request or media handoff.
- When **Automatically check for updates** is enabled in Settings, the app
  makes one request to `api.github.com` at startup for the latest Pawchive
  Client release metadata. It does not send account details or automatically
  download anything.
- Redirects are followed only when every hop is HTTPS and stays inside the
  allowlist. Redirects to other hosts are rejected.
- TLS certificate verification is never disabled.
- No credentials are sent unless the user explicitly signs in. The optional
  Pawchive session cookie is kept in the Rust backend and attached only to
  account/favorite API requests; public browsing requests do not need it.
- Login passwords are sent only to Pawchive's HTTPS login form, are never
  written to disk, and are never exposed to the frontend after submission.
  A remembered session is stored in `account.json` with owner-only permissions
  on Unix.
- The webview Content Security Policy permits images and media only from the
  Pawchive hosts plus local `data:`/`blob:` URLs. The frontend does not call the
  public API directly; it uses Tauri IPC.

### Remote content

- Post bodies, comments, revisions and announcements are sanitized in the Rust
  backend with an allowlist of tags, attributes and URL schemes before they
  reach React. Scripts, event handlers, iframes and `javascript:` URLs are
  removed.
- `dangerouslySetInnerHTML` is used only for this already-sanitized content.
  All other API text is rendered as ordinary React text.
- External links are opened through a validated backend command, never by
  navigating the application webview.
- Media URLs are validated against the Pawchive file host immediately before
  the player receives them. The player streams through the system webview; the
  Rust backend never buffers whole media files.

### Files and downloads

- Downloads are opt-in. The backend derives a safe filename, removes path
  separators/control characters and writes inside the configured download
  folder. Every file operation is contained to that folder.
- Download streams are written incrementally; files are never loaded whole into
  memory. Cancel removes the partial file. Delete/clear only removes files
  inside the download folder.
- The only user-selected file read is a subtitle chosen explicitly through the
  system file picker. The backend accepts only `.srt` and `.vtt`, enforces a 5 MB
  limit, converts SRT to WebVTT and never executes subtitle content.
- There is no shell, process or arbitrary filesystem permission exposed to the
  frontend. The opener can open validated links and the downloads folder.

### App permissions

The Tauri capability set is limited to the main window, the fullscreen state
used by the media player and image viewer, the system opener for validated
links and the downloads folder, and the file picker used for subtitles and the
download directory. Android also grants the app-exit command used by the
hardware back handler. There is no updater, telemetry or analytics.

## Data stored on disk

The app stores its SQLite database under the operating system's application
data directory:

- macOS: `~/Library/Application Support/pw.pawchive.client`
- Windows: `%APPDATA%\pw.pawchive.client`
- Linux: `~/.local/share/pw.pawchive.client`
- iOS/Android: the app's private application-data directory

The database contains:

- sidebar state, volume, playback speed and download folder (`settings`);
- a local copy of the public creator directory (`creators`);
- locally starred creators (`favorite_creators`);
- local playlists and their media references (`playlists`, `playlist_items`);
- download records and progress (`downloads`);
- last playback position and duration per media file (`playback_progress`).

Optional account sessions are stored in `account.json` only when “Remember me”
is enabled. Downloaded media is stored in the folder chosen in Settings on
desktop and in app-specific storage on mobile. On Android the default path is
`/storage/emulated/0/Android/data/pw.pawchive.client/files/Documents/Downloads`.
The database and session file are not encrypted; rely on full-disk encryption
and operating-system account security for at-rest protection.

No data is uploaded anywhere except the documented Pawchive API requests
needed to browse the archive and, when signed in, account/favorite requests.

## Known limitations

- Playback uses the platform webview's media engine. Container and codec
  support varies by platform. Unsupported files are reported in the player.
- The app displays content hosted by a third party. It sanitizes HTML and
  validates URLs, but cannot guarantee that third-party media is safe for every
  codec implementation. Keep the operating system and webview updated.
- The creator index is a public snapshot downloaded from the archive; it is not
  user data and contains no credentials.
- Downloaded files are written with the permissions of the current user. The
  app does not preserve remote permissions or metadata.
- Android release builds currently disable R8/minification because the minified
  build rendered a blank WebView. Re-enable it only after device testing.
- The Android APK in `artifacts/`, when present, is signed with the local debug
  keystore and is not a production-signed build.

## Dependency and release hygiene

- Dependencies are pinned in `package-lock.json` and `Cargo.lock`.
- CI runs formatting, Clippy with warnings denied, Rust tests, TypeScript
  type-checking, ESLint, frontend tests, a production frontend build and an
  Android debug/release build.
- Release builds are produced from tagged commits by GitHub Actions. Code
  signing and notarisation credentials, when configured, are supplied through
  repository secrets and are never committed.
