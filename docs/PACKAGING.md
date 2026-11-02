# Packaging

Pawchive Desktop uses Tauri 2's bundler. The configuration lives in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json).

## Build locally

```bash
npm install
npm run tauri build
```

Artifacts are written to `src-tauri/target/release/bundle/`:

| Platform | Bundles |
| -------- | ------- |
| macOS | `.app`, `.dmg` |
| Windows | NSIS `.exe` installer |
| Linux | `.deb`, `.rpm`, `.AppImage` |
| Android | `.apk` (per ABI or universal), `.aab` |

The app identifier is `pw.pawchive.desktop`; the product name is
`Pawchive Desktop`.

## Platform prerequisites

### macOS

- Xcode command line tools.
- For distribution: a Developer ID Application certificate and notarisation
  credentials. macOS builds are unsigned by default; add
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`
  as repository secrets, then uncomment the matching `APPLE_*` environment
  block in `.github/workflows/release.yml`.
- Universal builds require both Rust targets:

  ```bash
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  npm run tauri build -- --target universal-apple-darwin
  ```

### Windows

- WebView2 runtime (included with Windows 10/11; the installer can bootstrap it
  on older systems).
- Microsoft C++ Build Tools and the Windows SDK.
- NSIS is downloaded by the Tauri bundler. The configured install mode is
  `both` (the user can choose per-user or per-machine); change it in
  `tauri.conf.json` if a single mode is preferred.
- Optional code signing: set `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for updater signatures (the app does not
  ship an updater, so this is only needed if you add one).

### Linux

Install the Tauri build dependencies and runtime media plugins:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev librsvg2-dev patchelf \
  build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav
```

The AppImage configuration enables `bundleMediaFramework` so playback has a
bundled GStreamer framework. The `.deb` and `.rpm` packages declare the
GStreamer plugin sets as recommended dependencies; install them for full codec
support.

### Android

- JDK 17.
- Android SDK Platform 36, Build-Tools 36.0.0 and NDK `27.0.12077973`.
- Rust Android targets (`aarch64-linux-android`, `armv7-linux-androideabi`,
  `i686-linux-android`, `x86_64-linux-android`).

Build release APKs and an app bundle:

```bash
npm run android:build
npm run android:bundle
```

The generated Gradle project is tracked at `src-tauri/gen/android`. Its build
output, `local.properties`, keystores and signing properties are ignored.
Release APKs are unsigned; sign them with `apksigner` as described in
[docs/ANDROID.md](ANDROID.md). Never commit a production keystore.

Android release builds currently set `isMinifyEnabled = false`. The minified
build rendered a blank WebView; re-enable R8 only after verifying a release
build on a device. A release network security config permits cleartext only
for the Tauri asset host and the loopback media server; remote media uses
HTTPS. Debug builds allow LAN cleartext for the Vite dev server.

## Release automation

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds on a
`v*` tag for macOS (universal), Linux and Windows and attaches the bundles to a
draft GitHub release. The workflow installs platform dependencies, builds the
frontend and invokes `tauri-apps/tauri-action`.

Android builds are checked by
[`.github/workflows/android.yml`](../.github/workflows/android.yml), which
builds debug and release ARM64 APKs on every relevant push and pull request.
Publishing a signed Android build requires a production keystore supplied
through repository secrets.

Required repository permissions: `contents: write`.

Optional secrets for signed macOS builds (then uncomment the `APPLE_*` block
in `.github/workflows/release.yml`):

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

For Windows signing, configure the certificate in the workflow's environment
according to the Tauri code-signing documentation.

## Versioning

The version is declared in three places and must stay in sync:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Tag releases as `v1.0.0` (matching the version) so the release workflow and
installer metadata agree.

## Smoke test before publishing

1. Install the generated bundle on a clean machine/account.
2. Launch the app and confirm the first-run creator index completes.
3. Open Home, Discover, Creators, Search, a creator profile and a post.
4. Create a playlist, add an audio/video attachment, queue it and play it.
5. Download a single attachment, a post and a playlist; cancel one and confirm
   the partial file is removed.
6. Play an MP3/MP4, seek, change speed, toggle fullscreen and open the queue.
7. Close and reopen the app; confirm volume/speed, playlists, downloads and
   resume position persist.
8. If testing account login, sign in, sync favorite creators and sign out.
9. Verify unsupported codecs show a clear player error.
10. Confirm no terminal window, updater or unexpected network host appears.
11. On Android, verify the bottom tabs, hardware back, rotation/safe areas and
    downloaded-media playback. Confirm the release APK is signed with the
    production key before publishing.
