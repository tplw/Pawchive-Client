#!/bin/sh
# Remove build output and regenerable caches. Keeps node_modules and artifacts.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

rm -rf dist
rm -rf src-tauri/target
rm -rf src-tauri/gen/schemas

# Android build output and generated native wrappers.
rm -rf src-tauri/gen/android/.gradle
rm -rf src-tauri/gen/android/.kotlin
rm -rf src-tauri/gen/android/.tauri
rm -rf src-tauri/gen/android/build
rm -rf src-tauri/gen/android/app/build
rm -rf src-tauri/gen/android/buildSrc/build
rm -rf src-tauri/gen/android/app/src/main/assets
rm -rf src-tauri/gen/android/app/src/main/jniLibs
rm -rf src-tauri/gen/android/app/src/main/java/pw/pawchive/client/generated
rm -f src-tauri/gen/android/app/tauri.properties
rm -f src-tauri/gen/android/app/tauri.build.gradle.kts
rm -f src-tauri/gen/android/app/proguard-tauri.pro

# iOS build output and CocoaPods state.
rm -rf src-tauri/gen/apple/build
rm -rf src-tauri/gen/apple/Externals
rm -rf src-tauri/gen/apple/Pods
rm -rf src-tauri/gen/apple/Podfile.lock
rm -rf src-tauri/gen/apple/xcuserdata

find . -name .DS_Store -not -path "./node_modules/*" -delete 2>/dev/null || true

echo "Removed build output and caches. Kept node_modules and artifacts."
