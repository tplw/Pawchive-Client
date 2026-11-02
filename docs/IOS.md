# iOS Testing Setup

The iOS target is generated at `src-tauri/gen/apple`. The Xcode project and
CocoaPods workspace are already configured for:

- bundle identifier: `pw.pawchive.desktop`
- product name: `Pawchive Desktop`
- deployment target: iOS 15.0
- the generated Pawchive paw app icon

## Requirements

- macOS with **Xcode 15 or newer** installed and selected:
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
- Xcode command-line tools.
- CocoaPods (`brew install cocoapods`).
- Rust iOS targets (already installed by `tauri ios init`):
  `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`.
- An Apple ID and a development team for signing a physical device. Simulator
  builds do not need a paid developer account.

The generated project, CocoaPods and Rust targets are prepared. Builds use the
provided npm scripts so they work even when `xcode-select` still points at
CommandLineTools.

## Run on the simulator

```bash
npm run ios
```

This starts the Vite dev server, builds the Rust library for the selected
simulator, installs the app and launches it. Tauri will use the first available
simulator unless a device name is passed:

```bash
npm run ios -- "iPhone 17 Pro"
```

The npm scripts use `scripts/ios.sh`, which detects Xcode and supplies the
correct `DEVELOPER_DIR`/tool shims. This means you do **not** need to run
`sudo xcode-select` if your Mac still points at CommandLineTools. If you run
`npx tauri ios ...` directly instead, select Xcode first:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Tested on the **iPhone 17 Pro simulator with iOS 26.3**: the app builds,
installs, launches, displays Home, and loads Discover/Recent/Popular from the
live archive. Settings apply immediately, the software keyboard appears, and
multi-file post downloads complete in the app sandbox.

If you only want to open the project in Xcode:

```bash
npm run ios:open
```

Then select a simulator/device in Xcode and press **Run**.

## Run on a physical iPhone/iPad

1. Connect the device and trust it.
2. In Xcode open `src-tauri/gen/apple/pawchive-desktop.xcworkspace`.
3. Select the `pawchive-desktop_iOS` target → **Signing & Capabilities**.
4. Choose your Apple development team. Alternatively set the team through
   `APPLE_DEVELOPMENT_TEAM` or the Tauri iOS config:

   ```json
   "bundle": {
     "iOS": {
       "developmentTeam": "YOUR_TEAM_ID"
     }
   }
   ```

5. Run `npm run ios -- "Your iPhone Name"` or run from Xcode.

For a physical device, Tauri replaces `localhost` with your Mac's LAN address.
Make sure the Mac and iPhone are on the same network and allow the Vite dev
server through the macOS firewall if prompted.

If text fields focus but no software keyboard appears in the Simulator, turn off
**I/O → Keyboard → Connect Hardware Keyboard** (or run
`defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`
and restart Simulator). On a physical iPhone the software keyboard is used
normally.

## Production build

```bash
npm run ios:build
```

Open the resulting archive/project in Xcode to export a signed `.ipa`. Signing
and provisioning profiles are required for installation.

To produce an unsigned device IPA for external signing tools:

```bash
sh scripts/ios.sh build --no-sign --export-method debugging --ci
```

The IPA is written to
`src-tauri/gen/apple/build/arm64/Pawchive Desktop.ipa`. It cannot be installed
until it is signed with an Apple development certificate and provisioning
profile.

## What works on iOS

- Browsing, search, creator profiles and post detail.
- Playlists, queue, favorites and settings.
- Native WKWebView audio/video playback with the site's file host.
- Image viewer and fullscreen overlay with swipe navigation.
- Optional Pawchive login and favorite sync from Settings (the Account page and
  Account tab have been removed). Favorite creators can sync automatically on
  app start when enabled.

Platform-specific behavior:

- The desktop sidebar is replaced by a five-item bottom tab bar on iOS
  (Home, Discover, Search, Downloads, Settings).
- The iOS top bar shows the page title and Pawchive paw mark; the desktop
  search/back-forward controls are removed.
- Small post and playlist cards are square 1:1 tiles. Desktop defaults to
  Medium; iOS and Android default to Small.
- Inputs use a 16 px font size and the viewport disables pinch/auto-zoom, so
  focusing Search no longer zooms the app.
- Tap highlighting and double-tap zoom are disabled for a native feel.
- Swipe from the left edge to go back, matching the standard iOS navigation
  gesture.
- The full-screen player keeps the video letterboxed at its native aspect
  ratio. All controls, title and actions live in one bottom overlay above the
  home-indicator safe area, and the video extends underneath them.
- Tap the video once to hide every player control and again to restore it.
- Playback buttons are centered above the seek bar. The speed button cycles
  through the available speeds; there is no volume slider or subtitle button.
- The queue is a bottom sheet. It closes when the video is tapped or when you
  swipe right, so it has no close button.
- The last played queue item is restored when the app relaunches.
- Downloaded playlist items use a loopback media server with HTTP range
  support, so video and audio playback works offline and seeking still works.
- Downloads show local image thumbnails or video first frames, play locally
  when tapped, and all completed downloads can be added to a playlist at once.
- Direct public HTTPS media links in post text/embed data and archive
  `temp_url` files are supported for playback and downloads.
- Attachment rows show video/image resolution and file size.
- Links open directly in the system browser.
- API and media cache limits can be changed in Settings → Storage. Enable
  “Cache viewed media” to keep remote images/audio/video for faster repeat
  viewing; the oldest cached files are removed when the media limit is reached.
- Transcoding is desktop-only and requires ffmpeg. When enabled, unsupported
  media is converted to a compatible MP4 with live download/transcode progress.
  Local media URLs are cached and the loopback server supports HTTP cache
  validators, so offline playback and seeking start faster.
- Playlist rows show image/video thumbnails and open the viewer or player when
  tapped, with no separate play button.
- Playlist covers use the first usable item thumbnail and move to the next item
  when the first is removed.
- The image viewer is a full-screen portal with swipe navigation, pinch-to-zoom
  and panning. It shows fetch progress beside the file name. Its UI can be
  hidden with a tap and auto-hides after four seconds in landscape, matching
  the video player.
- The full-screen video player only auto-hides its controls in landscape. In
  portrait the controls stay visible.
- The minimized player has a queue button that opens a compact queue panel
  above the player bar.
- Each bottom tab keeps its own navigation stack and scroll position. A post
  opened from Home remains in the Home tab after switching to Discover and
  back.
- Back navigation and the left-edge swipe are scoped to the active tab; they
  never switch to another tab's page.
- Discover opens on Popular and has a service filter for both posts and
  creators.
- The full-screen player's X minimizes playback without stopping it, and the
  separate minimize control has been removed.
- Watch progress is saved on pause, navigation, app background and player
  close. Progress keys are normalized across posts, playlists and downloads so
  the same media resumes from any entry point.
- Creator pages have a filter button for audio-only posts, no-media posts and
  per-creator hidden keywords. Filters are stored on the device.
- The accent color follows the original Pawchive logo rose by default and can
  be changed in Settings. The paw mark follows the selected accent color.
- The download-folder picker is hidden. Downloads are saved to the app's
  Documents folder, which is exposed in the Files app via
  `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`. Open
  **Files → Browse → On My iPhone → Pawchive Desktop → Downloads**.
- Download completion is shown in the Downloads page. Per-file completion
  toasts are suppressed so a 25-file post does not cover the screen; at most
  three compact toasts are visible at once.
- “Open downloads folder” is hidden because iOS has no user-visible filesystem
  location for the app sandbox.
- Window dragging/fullscreen is a desktop concern; mobile uses the system
  full-screen window.
- Codec support is the same WKWebView limitation as macOS (MKV/AVI are not
  guaranteed).

## Regenerating the Xcode project

If you change `tauri.conf.json` iOS settings, app icons or native dependencies:

```bash
npx tauri ios init --ci
```

The generated project lives in `src-tauri/gen/apple` and is tracked. The
generated `.gitignore` excludes `Pods/`, `build/`, `Externals/` and Xcode user
data. If `tauri ios init` regenerates the Podfile and `pod install` complains
about a missing `pawchive-desktop_macOS` target, remove that macOS target block
from `src-tauri/gen/apple/Podfile` (the Xcode project only contains the iOS
target) and run `pod install` again.
