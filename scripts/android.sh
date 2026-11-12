#!/bin/sh
# Shared Android build helper for Pawchive Client.
#
# Locates Java 17 and the Android SDK, then forwards the command to the Tauri
# CLI. Run `sh scripts/android.sh doctor` to check the local toolchain.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

find_java_home() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    printf '%s\n' "$JAVA_HOME"
    return 0
  fi

  for candidate in \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
    /usr/lib/jvm/java-17-openjdk-amd64 \
    /usr/lib/jvm/java-17-openjdk \
    /usr/lib/jvm/temurin-17-jdk-amd64; do
    if [ -x "$candidate/bin/java" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [ -x /usr/libexec/java_home ]; then
    candidate=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
    if [ -n "$candidate" ] && [ -x "$candidate/bin/java" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  return 1
}

find_android_home() {
  for candidate in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk" \
    "${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk" \
    /opt/homebrew/share/android-commandlinetools \
    /usr/local/share/android-commandlinetools \
    /usr/lib/android-sdk; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! JAVA_HOME=$(find_java_home); then
  cat >&2 <<'EOF'
Java 17 was not found.

Install it with one of:
  macOS:  brew install openjdk@17
  Ubuntu: sudo apt-get install openjdk-17-jdk
  Windows: winget install EclipseAdoptium.Temurin.17.JDK

Then set JAVA_HOME to the JDK directory and rerun this script.
EOF
  exit 1
fi
export JAVA_HOME

if ! ANDROID_HOME=$(find_android_home); then
  cat >&2 <<'EOF'
The Android SDK was not found.

Install the command-line tools and set ANDROID_HOME:
  macOS:  brew install android-commandlinetools android-platform-tools
          export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
  Linux:  install the Android command-line tools from developer.android.com
          export ANDROID_HOME="$HOME/Android/Sdk"

Then run `npm run android:doctor` for the exact SDK packages to install.
EOF
  exit 1
fi

export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ -z "${NDK_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
  NDK_HOME=$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
fi
if [ -n "${NDK_HOME:-}" ]; then
  export NDK_HOME
  # aws-lc-sys (pulled in by Proton's SDK) looks for these names when it
  # configures its CMake build for Android.
  export ANDROID_NDK_ROOT="$NDK_HOME"
  export ANDROID_NDK="$NDK_HOME"
fi

export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/build-tools/37.0.0:$ANDROID_HOME/build-tools/36.0.0:$ANDROID_HOME/build-tools/35.0.0:$PATH"

usage() {
  cat <<'EOF'
Usage: npm run android -- <command> [options]

Commands:
  init       Generate src-tauri/gen/android
  dev        Run the app with hot reload on an emulator/device
  build      Build release APKs (default: --apk --split-per-abi)
  bundle     Build a release Android App Bundle (.aab)
  run        Build and run the app in production mode
  emulator   Start an Android emulator and wait for boot
  doctor     Print Java, SDK, NDK, Rust and device information
  clean      Remove generated Gradle build output

Examples:
  npm run android:init
  npm run android:dev -- "Pixel_7"
  npm run android:build -- --target aarch64
  npm run android:bundle
  npm run android:emulator
EOF
}

require_project() {
  if [ ! -d "$ROOT/src-tauri/gen/android" ]; then
    echo "Android project not found; running init first." >&2
    npx tauri android init --ci
  fi
}

doctor() {
  echo "Project:      $ROOT"
  echo "Java:         $JAVA_HOME"
  "$JAVA_HOME/bin/java" -version 2>&1 | sed 's/^/  /'
  echo "Android SDK:  $ANDROID_HOME"
  if [ -n "${NDK_HOME:-}" ]; then
    echo "NDK:          $NDK_HOME"
  else
    echo "NDK:          not found (install ndk;27.0.12077973)"
  fi
  echo
  echo "Installed SDK packages:"
  if command -v sdkmanager >/dev/null 2>&1; then
    sdkmanager --list_installed 2>/dev/null | sed -n '/Installed packages:/,$p' | head -40
  else
    echo "  sdkmanager not found"
  fi
  echo
  echo "Rust Android targets:"
  if command -v rustup >/dev/null 2>&1; then
    rustup target list --installed | grep -- '-android' || echo "  none installed"
  else
    echo "  rustup not found"
  fi
  echo
  echo "Devices:"
  if command -v adb >/dev/null 2>&1; then
    adb devices -l
  else
    echo "  adb not found"
  fi
  echo
  echo "Emulators:"
  if command -v emulator >/dev/null 2>&1; then
    emulator -list-avds
  else
    echo "  emulator not found"
  fi
}

start_emulator() {
  if ! command -v emulator >/dev/null 2>&1; then
    echo "The Android emulator is not installed. Run:" >&2
    echo "  sdkmanager \"emulator\" \"system-images;android-35;google_apis;arm64-v8a\"" >&2
    exit 1
  fi

  AVD=${1:-${PAWCHIVE_AVD:-}}
  if [ -z "$AVD" ]; then
    AVD=$(emulator -list-avds | head -n 1)
  fi
  if [ -z "$AVD" ]; then
    echo "No Android Virtual Device found. Create one with:" >&2
    echo "  avdmanager create avd -n Pawchive_API_35 -k \"system-images;android-35;google_apis;arm64-v8a\" -d pixel_7" >&2
    exit 1
  fi

  if adb devices | grep -q '^emulator-.*device'; then
    echo "An emulator is already running."
    adb devices -l
    return 0
  fi

  LOG="$ROOT/src-tauri/target/android-emulator.log"
  mkdir -p "$ROOT/src-tauri/target"
  echo "Starting $AVD (log: $LOG)"
  nohup emulator -avd "$AVD" -no-snapshot -no-audio -no-boot-anim -gpu swiftshader_indirect \
    >"$LOG" 2>&1 &
  echo $! >"$ROOT/src-tauri/target/android-emulator.pid"

  adb wait-for-device
  printf 'Waiting for Android to finish booting'
  i=0
  while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      echo
      echo "The emulator did not finish booting. See $LOG." >&2
      exit 1
    fi
    printf '.'
    sleep 2
  done
  echo " ready."
  adb devices -l
}

COMMAND=${1:-doctor}
if [ $# -gt 0 ]; then
  shift
fi

case "$COMMAND" in
  init)
    exec npx tauri android init --ci "$@"
    ;;
  dev)
    require_project
    exec npx tauri android dev "$@"
    ;;
  build)
    require_project
    exec npx tauri android build --ci --apk --split-per-abi "$@"
    ;;
  bundle)
    require_project
    exec npx tauri android build --ci --aab --split-per-abi "$@"
    ;;
  run)
    require_project
    exec npx tauri android run "$@"
    ;;
  emulator)
    start_emulator "$@"
    ;;
  doctor)
    doctor
    ;;
  clean)
    rm -rf \
      "$ROOT/src-tauri/gen/android/.gradle" \
      "$ROOT/src-tauri/gen/android/build" \
      "$ROOT/src-tauri/gen/android/app/build" \
      "$ROOT/src-tauri/gen/android/buildSrc/build"
    echo "Removed generated Android build output."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage >&2
    exit 1
    ;;
esac
