Pawchive Desktop 1.0.0 artifacts
================================

These files are local build artifacts and are intentionally ignored by Git.
They were rebuilt from the current source on 2026-11-01 and are provided for
testing; use the release workflows or the instructions in docs/PACKAGING.md to
produce distribution builds.

Pawchive Desktop_1.0.0_android-arm64.apk
- Android 7.0+ (minSdk 24), arm64-v8a.
- Release build signed with the local Android debug keystore for sideloading.
- Install with:
    adb install -r "Pawchive Desktop_1.0.0_android-arm64.apk"
- NOT production-signed. Sign with your own keystore before distribution and
  uninstall any existing copy if the signing key changes.
- Release minification is disabled until the R8 blank-WebView issue is fixed.
  See docs/ANDROID.md.

Pawchive Desktop_1.0.0_unsigned.ipa
- Device build for arm64 iPhone/iPad, iOS 15+.
- UNSIGNED: this Mac has no Apple Development certificate or provisioning
  profile, so the IPA cannot be installed directly.
- Sign it with your Apple ID/team using Xcode, Sideloadly, AltStore, or
  another signing tool before installing.
- See docs/IOS.md.

Pawchive Desktop_1.0.0_aarch64.dmg
- macOS Apple Silicon build.
- Signing/notarization status follows the local Tauri build; install on macOS
  and follow Gatekeeper prompts if it is not notarized.
- See docs/PACKAGING.md.
