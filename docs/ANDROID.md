# Android

Pawchive Client builds for Android through Tauri 2 and the shared React
interface. The generated Gradle project is tracked at
`src-tauri/gen/android`; build output and signing material are ignored.

- Application ID: `pw.pawchive.client` (changed from `pw.pawchive.desktop` in 1.0.2; installs as a new app)
- Minimum SDK: 24 (Android 7.0)
- Compile/target SDK: 36 (Android 16)
- Architectures: `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`
- UI: the same mobile shell as iOS (bottom tabs, safe areas, small cards)

## Requirements

- Node.js 20.19+ and npm.
- Rust stable with the Android targets.
- JDK 17.
- Android SDK command-line tools, platform-tools, Platform 36,
  Build-Tools 36.0.0 and NDK `27.0.12077973`.
- An emulator system image or a physical device for testing.

### macOS setup

```bash
brew install openjdk@17 android-commandlinetools android-platform-tools

export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

yes | sdkmanager --licenses
sdkmanager \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "ndk;27.0.12077973" \
  "emulator" \
  "system-images;android-35;google_apis;arm64-v8a"

rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  i686-linux-android \
  x86_64-linux-android
```

On an Intel Mac, use the `x86_64` system image instead of `arm64-v8a`.
`scripts/android.sh` finds Homebrew's JDK/SDK automatically, so exporting the
variables is optional after installation.

### Linux/Windows

Install the Android command-line tools from
[developer.android.com](https://developer.android.com/studio#command-tools),
set `ANDROID_HOME`, and install the same SDK packages. JDK 17 and the Rust
targets above are required on every platform.

## Check the toolchain

```bash
npm run android:doctor
```

This prints the detected Java, SDK, NDK, Rust targets, connected devices and
available emulators.

## Emulator

Create an AVD once (the commands below assume an Apple Silicon Mac):

```bash
avdmanager create avd \
  -n Pawchive_API_35 \
  -k "system-images;android-35;google_apis;arm64-v8a" \
  -d pixel_7
```

Start it and wait for boot:

```bash
npm run android:emulator
```

Use a different AVD with `PAWCHIVE_AVD` or an argument:

```bash
PAWCHIVE_AVD=Pixel_9 npm run android:emulator
npm run android:emulator -- Pixel_9
```

## Run in development

```bash
npm run android:dev
```

This starts Vite and the Tauri dev server, builds the Rust library, installs
the app and attaches hot reload. To target a connected device, start it first
and pass the device name/serial:

```bash
adb devices -l
npm run android:dev -- emulator-5554
```

If the Android project is missing, the script runs `tauri android init`
automatically. Regenerate it explicitly after changing app icons, native
dependencies or the Android configuration:

```bash
npm run android:init
```

## Build

Release APKs, split per ABI:

```bash
npm run android:build
```

The unsigned files are written to:

```text
src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk
src-tauri/gen/android/app/build/outputs/apk/arm/release/app-arm-release-unsigned.apk
src-tauri/gen/android/app/build/outputs/apk/x86/release/app-x86-release-unsigned.apk
src-tauri/gen/android/app/build/outputs/apk/x86_64/release/app-x86_64-release-unsigned.apk
```

Build only ARM64:

```bash
npm run android:build -- --target aarch64
```

Build a debug APK (installable without extra signing):

```bash
npm run android:build -- --debug --target aarch64
```

The debug APK is at
`src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.

Build an Android App Bundle:

```bash
npm run android:bundle
```

## Signing

Release APKs produced by Tauri are unsigned. For local testing, sign with the
Android debug keystore (created automatically by the Android tools):

```bash
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export PATH="$ANDROID_HOME/build-tools/36.0.0:$JAVA_HOME/bin:$PATH"

apksigner sign \
  --ks "$HOME/.android/debug.keystore" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "Pawchive_1.0.2_android-arm64.apk" \
  "src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk"
```

Debug-signed APKs are fine for sideloading and testing but are **not**
suitable for distribution. Create a production keystore and keep it outside the
repository:

```bash
keytool -genkeypair -v \
  -keystore "$HOME/keys/pawchive-release.jks" \
  -alias pawchive \
  -keyalg RSA -keysize 4096 -validity 10000

apksigner sign \
  --ks "$HOME/keys/pawchive-release.jks" \
  --out "Pawchive_1.0.2_android-arm64.apk" \
  "src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk"
```

Never commit a `.jks`/`.keystore` file or its passwords. For CI, pass the
keystore and passwords through repository secrets and sign after the build.

## Install on a device

```bash
adb install -r "Pawchive_1.0.2_android-arm64.apk"
```

If a debug-signed build replaces a production-signed install (or the reverse),
uninstall the existing app first:

```bash
adb uninstall pw.pawchive.client
```

## Android behavior

- The launcher icon and launch splash use the Pawchive paw mark. The loading
  screen shows only the logo.
- Home, Discover, Search, Downloads and Settings use a five-item bottom tab
  bar. Each tab keeps its own navigation stack and scroll position.
- The Android system back button closes overlays and the full-screen player,
  walks back through the active tab, returns to Home from another tab, and
  closes the app at the Home root.
- Downloads are stored in app-specific external storage:
  `/storage/emulated/0/Android/data/pw.pawchive.client/files/Documents/Downloads`.
  The desktop folder picker and “Open folder” button are hidden.
- Transcoding is desktop-only and is hidden on Android.
- Local playback uses the loopback media server with HTTP range support, so
  downloaded audio/video plays offline and can seek.
- Codec support depends on the installed Android System WebView. MP4/H.264,
  WebM/VP8-9, MP3, AAC, FLAC and Opus are typically available; MKV/AVI are not
  guaranteed.
- A network security config permits cleartext only for the Tauri asset host and
  the loopback media server (`127.0.0.1`, `localhost`, `tauri.localhost`,
  `ipc.localhost`). Remote archive and media requests still use HTTPS. Debug
  builds allow LAN cleartext so the Vite dev server can be reached.
- Android release builds currently disable R8/minification. The minified build
  rendered a blank WebView; re-enable it only after verifying a release build
  on a device.

## Known limitations

- The release APK in `artifacts/` (when present) is debug-signed for testing.
- App-specific downloads are removed when the app is uninstalled and are not
  exposed through the system Files app on all devices.
- Background playback and picture-in-picture are not implemented; watch
  progress is saved when the app is backgrounded.
- The R8/minification issue above must be resolved before publishing a
  production release.

## Troubleshooting

- **`JAVA_HOME`/Java not found** — install JDK 17 and rerun
  `npm run android:doctor`.
- **SDK package missing** — install the exact packages listed in
  [Requirements](#requirements), then rerun the build.
- **Blank release screen** — confirm `isMinifyEnabled = false` in
  `src-tauri/gen/android/app/build.gradle.kts`. If you re-enable R8, test on a
  device and add the required keep rules.
- **Emulator does not boot** — check
  `src-tauri/target/android-emulator.log`, or start the AVD from Android Studio.
- **Device not listed** — enable USB debugging, accept the RSA prompt and run
  `adb devices -l`.
- **Install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** — uninstall the
  existing app, then install again.
