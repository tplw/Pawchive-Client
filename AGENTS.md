# AGENTS.md

Pawchive Client is a Tauri 2 desktop and mobile client for the Pawchive
archive. The backend is Rust, the interface is React and TypeScript, and the
database is SQLite. The app runs on macOS, Windows, Linux, iOS and Android.

Frontend stack: React 19, Vite 7, Tailwind CSS 3, TanStack Query 5 and
Zustand 5. Backend stack: Tauri 2, Tokio, Reqwest, Serde and Rusqlite.

The product name is Pawchive. The application and bundle identifier is
`pw.pawchive.client`. Changing that identifier creates a separate app and
breaks local data continuity, so treat it as fixed.

This file is for coding agents. Read it before changing code, then read
`docs/architecture/CONTRACTS.md` and the files for the feature you are editing.

The project tree in `README.md` is out of date. It still mentions
`src/services`, `src/components` and `src/player`, which no longer exist. Use
the map below and the actual files.

## Quick start

```bash
npm ci
npm run tauri dev
```

The first launch downloads the creator index in the background. Later launches
reuse the local SQLite copy.

## Repository map

| Path | What lives there |
| --- | --- |
| `src/app/` | Shell, routing, tab stacks, navigation, bootstrap and the global app store |
| `src/features/` | Vertical slices: account, creators, downloads, media, player, playlists, posts, search, settings, updates |
| `src/features/<name>/ui/` | React screens and feature UI |
| `src/features/<name>/model/` | Feature state, hooks and helpers |
| `src/shared/` | Tauri API wrappers, DTO types, query keys, shared UI and helpers |
| `src/shared/api.ts` | The only place that calls `invoke` for application commands |
| `src/shared/types.ts` | Frontend mirror of the Rust DTOs |
| `src/shared/query/keys.ts` | TanStack Query key factories |
| `src/shared/ui.tsx` | Shared primitives such as `Button`, `Modal`, `Toggle`, `IconButton` |
| `src/test/setup.ts` | Vitest environment setup and media/storage mocks |
| `src-tauri/src/commands.rs` | Tauri command surface |
| `src-tauri/src/lib.rs` | App setup and command registration |
| `src-tauri/src/app/state.rs` | Shared `AppState` |
| `src-tauri/src/features/` | Backend feature services and use cases |
| `src-tauri/src/infra/` | Pawchive API, providers, SQLite, loopback HTTP, downloads, cache, transcode |
| `src-tauri/src/shared/` | Config, errors, models, security, version, logging |
| `src-tauri/migrations/` | Append-only SQLite migrations |
| `src-tauri/gen/android/` | Tracked Gradle project. Build output is ignored |
| `src-tauri/gen/apple/` | Tracked Xcode project. Build output and Pods are ignored |
| `scripts/` | Android, iOS, clean and release helpers |
| `docs/` | Platform, packaging, player, performance and architecture notes |
| `.github/workflows/` | CI, Android, Release and Mobile Release workflows |

## Branches and releases

- Work on `dev`. It is the integration branch.
- `main` holds released, stable code. Do not push to `main` unless the user
  explicitly asks for a release or a release task requires it.
- Tags use `vX.Y.Z` or `vX.Y.Z.W`. Do not move or reuse a published tag.
- Do not run `scripts/push.py` or `scripts/push.sh` unless the user explicitly
  asks for a release. The script runs `git add -A`, commits everything, and
  pushes the current HEAD to `main`. It does not protect uncommitted work.
- Keep unrelated changes out of feature commits. Stage explicit paths, not
  `git add -A`.
- If the checkout is dirty and a task needs a clean branch, use a separate
  Git worktree. Do not overwrite another agent's or the user's files.

## Setup

Requirements:

- Node.js 20.19+ or 22.12+. CI uses Node 22.
- Rust stable with `rustfmt` and `clippy`. The crate requires Rust 1.96.
- Tauri 2 platform prerequisites.
- macOS: Xcode command line tools.
- Windows: WebView2 and Microsoft C++ Build Tools.
- Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `patchelf`, a C compiler and the GStreamer plugin sets.
- iOS: macOS, Xcode 15+ and CocoaPods.
- Android: JDK 17, Android SDK Platform 36, Build-Tools 36.0.0 and NDK
  `27.0.12077973`.

Use `npm ci` when dependencies have not changed. Use `npm install` only when
adding or updating a dependency, and commit `package-lock.json` with it.

## Commands

| Task | Command |
| --- | --- |
| Run the real app | `npm run tauri dev` |
| Run only the Vite frontend | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint with zero warnings | `npm run lint` |
| Frontend tests | `npm test` |
| Frontend tests in watch mode | `npm run test:watch` |
| Frontend production build | `npm run build` |
| Desktop bundles | `npm run tauri build` |
| Rust formatting | `cd src-tauri && cargo fmt --check` |
| Rust lint | `cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings` |
| Rust tests | `cd src-tauri && cargo test --workspace` |
| Android toolchain check | `npm run android:doctor` |
| Android dev/build | `npm run android:dev`, `npm run android:build` |
| iOS dev/build | `npm run ios`, `npm run ios:build` |
| Remove build output and caches | `npm run clean` |

`npm run dev` alone does not provide the Tauri IPC backend. Most screens will
fail until you run `npm run tauri dev`.

## Quality gates

Run the checks that match the change before committing:

```bash
npm run typecheck
npm run lint
npm test
npm run build

cd src-tauri
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For Android changes, also run `npm run android:doctor` and at least a debug
build. For iOS changes, run the simulator build. For shared UI, navigation,
playback or downloads, test desktop and one mobile target when the environment
allows it.

## Architecture

The flow is:

```text
React screen -> src/shared/api.ts -> Tauri command -> feature service
             -> infra (SQLite, Pawchive API, provider, loopback HTTP)
```

Backend rules:

- `src-tauri/src/commands.rs` contains thin Tauri command wrappers. Put use
  cases in `src-tauri/src/features/<name>/service.rs`.
- `src-tauri/src/infra/` owns external I/O and persistence. Do not put SQL,
  provider HTTP calls or filesystem work in a command.
- `AppState` is cloned into background jobs. Keep it cheaply cloneable.
- Commands return `AppResult<T>`. Use `AppError`; do not panic on user input.
- Database work runs on the blocking pool through `shared::task::blocking`.
- Tauri events are emitted from backend jobs. Keep event names and payload
  fields stable.
- Register every new command in `src-tauri/src/lib.rs`. An unregistered command
  compiles but fails at runtime.
- Do not add a runtime dependency without a concrete need and maintainer
  approval. The accepted crypto and media exceptions are `proton-drive-rs`,
  `hmac`, `pbkdf2`, `aes`, `ctr` and `rustls-platform-verifier`.

Frontend rules:

- Server state belongs in TanStack Query. App and player state belongs in
  Zustand. Do not copy server data into a second store.
- Add API calls to `src/shared/api.ts` and types to `src/shared/types.ts`.
  Do not call `invoke` from a component.
- Add or reuse a query key in `src/shared/query/keys.ts`. Invalidate the
  smallest affected key.
- Keep feature UI in `ui/` and feature state/helpers in `model/`. Export only
  the public surface through the feature's `index.ts` when one exists.
- Use the shared primitives and existing Tailwind tokens. Do not add a second
  design system.
- Keep mobile layouts safe-area aware and respect `isMobile`, `isIos` and
  `isAndroid`.

## Common change paths

- New command: implement in a feature service, add the wrapper in
  `src-tauri/src/commands.rs`, register it in `lib.rs`, add the TypeScript
  wrapper to `src/shared/api.ts`, add or update the DTO in
  `src/shared/types.ts`, add the query key if needed, then test both sides.
- New route: update `PageName` and `Route` in `src/shared/types.ts`, the
  parser and serializer in `src/shared/lib/router.ts`, `RoutePage.tsx` and
  `tabForRoute`, then add a navigation test.
- New setting: add the field and default to `AppSettings` in
  `src-tauri/src/shared/models/settings.rs`, mirror it in
  `src/shared/types.ts` and `DEFAULT_SETTINGS`, add the Settings control, then
  test persistence after a restart.
- New migration: add `src-tauri/migrations/000N_name.sql`, append it to
  `MIGRATIONS` in `src-tauri/src/infra/sqlite/mod.rs`, and add a round-trip
  test. Never edit an old migration.
- New provider: follow the provider checklist under media and provider rules.

## Contracts that must not change casually

`docs/architecture/CONTRACTS.md` is the reference. The important ones:

- Tauri command names, argument names, camelCase DTO fields and `AppError`
  codes, messages and retryability.
- Tauri events: `download://progress`, `download://complete`,
  `download://error`, `transcode://progress`, `media-cache://progress` and
  `creators://synced`.
- `AppError` reaches the frontend as
  `{ code, message, retryable, provider?, url?, rejected? }`.
- Cancellable commands accept a `requestId`. In `src/shared/api.ts`, wrap them
  with `cancellable(signal, ...)`; in the service, register and finish the
  token in `AppState`.
- Routes and hash parsing:
  `#/home`, `#/discover`, `#/creators`, `#/creator/:service/:creatorId`,
  `#/post/:service/:creatorId/:postId`, `#/search`, `#/playlist/:id`,
  `#/downloads`, `#/settings`.
- Tab stacks, `previousRoute`, keyed post remounts, scroll restoration and the
  mobile back/edge-swipe behavior.
- Browser storage:
  - `localStorage["pawchive-player"]`: queue and current id only.
  - `localStorage["pawchive-creator-filter:<service>:<creatorId>"]`:
    per-creator filters.
  - `sessionStorage["pawchive-creator-tab:<service>:<creatorId>"]`: selected
    creator profile tab.
  - `sessionStorage["pawchive-scroll-positions"]`: scroll offsets.
- DOM contracts: `#main-scroll`, `[data-modal-open="true"]`,
  `data-card-size`, `data-tauri-drag-region`.
- Window events: `pawchive:save-progress`, `pawchive:seek`,
  `pawchive:scroll-top`, `pawchive:close-queue`, `pawchive:focus-search`.
- Pagination: 50 posts and 60 creators per page. Search requires at least 3
  characters.
- Provider labels and classifier values: `pawchive`, `mega`, `proton`,
  `googleDrive`, `dropbox`, `gofile`, `external`. Keep the existing provider
  order in UI and filters.
- `Attachment.locked` means the provider link needs a password.
  `Attachment.resolving` means provider metadata is still loading.
- Post detail uses two passes. `get_post` returns fast attachments with
  `resolving: true`; `resolve_post_attachments` enriches them. Do not make
  `get_post` wait for provider metadata again.
- `PostSummary.unavailable` drives the unavailable-post filter. Unimported
  Kemono previews with only an archive-relative path are unavailable. A direct
  HTTPS link or temporary signed URL keeps them available.

If a shape must change, add an explicit migration and update both sides of the
contract and the tests.

## Data and storage

App data contains:

| File or directory | Purpose |
| --- | --- |
| `pawchive.sqlite3` | Settings, creator index, playlists, downloads, progress |
| `provider-passwords.json` | Remembered MEGA and Proton passwords, 0600 on Unix |
| `account.json` | Optional Pawchive account session |
| `media-cache/` | Hashed media cache with atomic temporary files |
| `downloads/` | Default desktop download folder |

Mobile downloads live under the app's Documents directory. The iOS app
container can move between installs, so resolve paths at use time and do not
treat a stored absolute path as permanent.

SQLite migrations are append-only. Add a new `src-tauri/migrations/000N_name.sql`
file and include it in `MIGRATIONS` in `src-tauri/src/infra/sqlite/mod.rs`.
Never edit a migration that has shipped.

## Media and provider rules

Provider links are resolved in Rust and served through the loopback media
server. Do not give a provider page URL directly to `<video>`.

- MEGA: encrypted file and folder links, password links (`#P!`), AES-CTR range
  streaming, folder child nodes. Folder children use `MegaStream::new_folder`
  and the folder-aware resolver; do not pass them to `parse_file_link`. CDN
  links expire, so range streams refresh the file metadata before failing.
- Proton Drive: public-link SDK, custom passwords stored per share token,
  child nodes addressed with `?pawchive_node=<volume>~<link>`, range streams.
- Google Drive, Dropbox and GoFile: resolve to a loopback URL with normal HTTP
  Range support.
- Direct HTTPS media links in post text or embeds are extracted and validated
  in Rust.
- The loopback server supports GET, HEAD, Range, ETag and provider headers.

MEGA password links use PBKDF2-HMAC-SHA512 and HMAC-SHA256. Tests cover legacy
algorithm 1 and algorithm 2. Do not change the crypto without known test
vectors.

When adding a provider, update the Rust classifier and enum, the TypeScript
union and classifier, the resolver, `MediaService`, downloads, cache, size and
dimension probes, thumbnail handling, provider labels, password support if
needed, tests and docs. Do not reorder existing providers.

## Security rules

- Validate URLs, paths and remote HTML in Rust, not only in React.
- Remote media is HTTPS-only on port 443. Private, loopback, link-local,
  carrier-grade NAT and metadata addresses are rejected. The media client also
  filters DNS results.
- Redirects must stay on HTTPS and either a public host or the allowlist.
- Creator HTML goes through `sanitize_html`. Do not use
  `dangerouslySetInnerHTML` on unsanitized data.
- The Tauri capability set in `src-tauri/capabilities/default.json` is
  minimal. Add a permission only when the feature needs it.
- Do not widen the CSP without a concrete requirement.
- Never log or persist session cookies, passwords or expiring signed URLs.
- Store provider passwords through `ProviderPasswords`, never in localStorage,
  a query key or a log line. Remembered passwords go to
  `provider-passwords.json` with 0600 permissions on Unix.
- Never commit keystores, provisioning profiles, certificates, `.env` files or
  built APK, DMG or IPA files.

## Platform notes

### Desktop

- macOS builds are unsigned by default. Users may need right-click, Open.
- Windows uses WebView2 and an NSIS installer with per-user or per-machine
  install.
- Linux `.deb` and `.rpm` recommend GStreamer plugins. The AppImage bundles the
  media framework.
- Transcoding is desktop-only and requires `ffmpeg` on `PATH` or in a common
  install folder.

### Android

- Application ID: `pw.pawchive.client`. Minimum SDK 24, target SDK 36.
- `scripts/android.sh` locates JDK 17 and the Android SDK. `npm run
  android:doctor` prints the detected toolchain.
- The Gradle project in `src-tauri/gen/android` is tracked. Keep configuration
  changes in sync and do not commit build output, `local.properties` or
  keystores.
- Release builds set `isMinifyEnabled = false`. A minified build previously
  produced a blank WebView. Re-enable R8 only after testing on a device.
- Local release APKs are unsigned. The tag workflow generates an ephemeral
  debug keystore, zipaligns, signs and verifies both APKs before upload.
  Production store releases still need a production keystore.
- Android TLS uses `rustls-platform-verifier` plus its Kotlin AAR wired through
  Gradle. Do not remove that setup.

### iOS

- Xcode 15+, CocoaPods, iOS 15+.
- Use `scripts/ios.sh` through the npm scripts. It points Xcode tools at the
  right developer directory, so `sudo xcode-select` is not required.
- The generated Xcode project is tracked. `src-tauri/Info.ios.plist` overrides
  the marketing and build version so four-part releases stay in sync.
- When changing iOS config, regenerate with `npx tauri ios init --ci` and keep
  the generated project, `Info.plist` and `project.yml` consistent.
- The unsigned IPA is for external signing tools. KSign source metadata lives
  in `docs/ksign-source.json`.
- Downloads are exposed through the Files app. The folder picker is hidden.

## Testing

Frontend tests use Vitest, jsdom and Testing Library. Files are colocated as
`*.test.ts` or `*.test.tsx` under `src/`. The setup file mocks media elements,
storage and cleanup. The test command is `npm test`; it runs once.

Rust tests are inline `#[cfg(test)]` modules. HTTP tests use `wiremock`; file
tests use `tempfile`. Run `cargo test --workspace` from `src-tauri`. For a
focused run, use `cargo test --lib <name>`.

For a bug fix:

1. Write the smallest test that fails for the reported behavior.
2. Run it and read the failure.
3. Make the smallest production change that passes.
4. Run the focused test and then the surrounding suite.

Do not weaken a test to match a wrong implementation. Do not replace a real
check with a mock-only assertion.

When adding a Tauri command, add the wrapper to `src/shared/api.ts` and add the
mock to every frontend test that renders the caller. A missing mock usually
shows up as an unrelated `invoke` failure.

## Change checklist

1. Run `git status --short` and note existing uncommitted work.
2. Read `docs/architecture/CONTRACTS.md` and the relevant feature.
3. Add or update the test first for a bug.
4. Keep the change inside the current architecture. Do not refactor unrelated
   code.
5. Run the frontend and Rust gates that match the change.
6. Add a bullet to the `Unreleased` section of `CHANGELOG.md` for user-visible
   changes. Update docs when setup, behavior or platform support changes.
7. Run `git diff --check`. Stage only the files you changed. Commit on `dev`
   with an imperative subject such as
   `fix(player): keep the queue when playing a single media`.
8. Report the commands and results you actually ran. Do not claim a platform
   build you did not run.

## Release checklist

Release only on explicit request.

Version locations that must agree:

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | root `version` and `packages[""].version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | `pawchive-client` package version |
| `src-tauri/tauri.conf.json` | `version` and `bundle.iOS.bundleVersion` |
| `src-tauri/src/shared/version.rs` | `APP_VERSION` |
| `src-tauri/Info.ios.plist` | `CFBundleShortVersionString`, `CFBundleVersion` |
| `src-tauri/gen/apple/pawchive-client_iOS/Info.plist` | same two keys |
| `src-tauri/gen/apple/project.yml` | same two keys |

Cargo and Tauri accept three-part versions. A four-part release such as
`1.0.6.1` uses the next three-part bundle version internally and the release
script renames the assets. `scripts/push.py` updates most version files, but
verify the generated iOS files by hand.

Release steps:

1. Confirm `dev` is green and `CHANGELOG.md` has a section for the version.
2. Bump every version location above.
3. Run all frontend and Rust gates.
4. Fast-forward `main` to the release commit. Do not create a merge commit if
   `main` is an ancestor of `dev`.
5. Tag `vX.Y.Z`, push `main` and the tag.
6. Wait for both the `Release` and `Mobile Release` workflows.
7. Verify all expected assets exist. The normal set is 10: macOS DMG, macOS app
   tarball, Windows EXE and MSI, Linux AppImage, deb and rpm, Android arm64 and
   armv7 APKs, iOS IPA.
8. Publish the draft with the established title and body style:
   `Pawchive vX.Y.Z`, the changelog section, Desktop, Android, iOS, Updates and
   `Built from commit <short>`.
9. Verify the Android APK signature with `apksigner verify --verbose
   --print-certs`.
10. Update the Homebrew cask in `packaging/homebrew/Casks/pawchive.rb` and in
    the `tplw/homebrew-pawchive` tap with the DMG SHA256.
11. Add the iOS IPA entry to `docs/ksign-source.json` with version, date, URL,
    exact size and minimum OS.

Do not publish a release with missing assets or failed mobile workflows. Do not
move a tag after publishing. Publish a patch release instead.

## Known traps

- `scripts/push.py` stages every change and pushes `main`. Never run it as a
  normal commit helper.
- Reqwest request-builder timeouts include the response body. Do not add a
  total timeout to streaming media. Use a per-read idle timeout.
- The persistent `<video>` element emits events for the previous item after a
  queue switch. Confirm the loaded item before applying duration, time,
  progress or buffering updates. Pause the element before resolving a new
  item; a failed source must not leave the previous audio playing.
- The iOS app container can move. Do not trust saved absolute paths.
- `src-tauri/tauri.conf.json` must keep a three-part `version`. Only
  `APP_VERSION` and the iOS plists carry a four-part release version.
- Generated iOS version files are easy to miss. Check all three. Regenerating
  the Xcode project can rewrite `Info.plist`, so re-apply the version and
  compare `project.yml` before release.
- Android release APKs built locally are unsigned. The tag workflow signs them;
  a local `npm run android:build` does not.
- The v1.0.6 APKs were published before the signing fix and are unsigned. A
  patch release is required if a user reports an Android install failure.
- Global content filters run in Rust before per-creator client filters. A
  per-creator toggle can remove more posts but cannot restore a post the
  backend already removed.
- Provider metadata body reads do not all have timeouts. Do not hold a shared
  provider mutex across a body read.

The audit findings above were open on 2026-11-14. Remove a trap when it is
fixed.

## Read more

- `docs/architecture/CONTRACTS.md`: command, route, storage, event and media
  contracts.
- `docs/architecture/REBUILD.md`: why the feature-slice layout exists.
- `docs/PACKAGING.md`: builds, signing and release automation.
- `docs/ANDROID.md`: Android setup, signing and limitations.
- `docs/IOS.md`: Xcode, signing, unsigned IPA and KSign.
- `docs/PLAYER.md`: why the app uses the system webview media engine.
- `docs/PERFORMANCE.md`: cache, streaming and performance checks.
- `docs/pawchive_openapi.json`: archive API shape.
- `CHANGELOG.md`: user-visible changes and release notes.
- `SECURITY.md`: how to report vulnerabilities.
