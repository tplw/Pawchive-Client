Pawchive Client 1.0.0 artifacts
================================

These files are local test builds and are intentionally ignored by Git.
Desktop installers are published on the GitHub Releases page.

Pawchive Client_1.0.0_android-arm64.apk
- Android 7.0+, arm64-v8a. Debug-signed for sideloading/testing.
- Install with:
    adb install -r "Pawchive Client_1.0.0_android-arm64.apk"

Pawchive Client_1.0.0_android-armv7.apk
- Android 7.0+, armeabi-v7a. Debug-signed for sideloading/testing.

Pawchive Client_1.0.0_unsigned.ipa
- Device build for arm64 iPhone/iPad, iOS 15+.
- UNSIGNED: sign it with an Apple ID/team before installing.
- See docs/IOS.md.

The Android APKs use the local debug keystore. Never use that key for a
production store release.
