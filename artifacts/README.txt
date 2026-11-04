Pawchive 1.0.3 artifacts
========================

These files are local test builds and are intentionally ignored by Git.
Official downloads are on the GitHub Releases page:
https://github.com/tplw/Pawchive-Client/releases/tag/v1.0.3

Pawchive_1.0.3_universal.dmg
- macOS universal installer (Apple Silicon + Intel).

Pawchive_universal.app.tar.gz
- Universal macOS app bundle used by release tooling.

Pawchive_1.0.3_ios-unsigned.ipa
- Device build for arm64 iPhone/iPad, iOS 15+.
- UNSIGNED: sign it with an Apple ID/team before installing.
- See docs/IOS.md.

Pawchive_1.0.3_android-arm64.apk
- Android 7.0+, arm64-v8a. Debug-signed for sideloading/testing.

Pawchive_1.0.3_android-armv7.apk
- Android 7.0+, armeabi-v7a. Debug-signed for sideloading/testing.

The Android APKs use the local debug keystore. Never use that key for a
production store release.
