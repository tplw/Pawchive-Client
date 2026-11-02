# Contributing to Pawchive Client

Thanks for taking the time to improve Pawchive Client. This guide covers the
development workflow, quality checks and pull-request expectations.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search the existing issues and pull requests before opening a new one.
- For larger changes, open an issue first so the approach can be discussed.
- Do **not** report security vulnerabilities in a public issue. Follow
  [SECURITY.md](SECURITY.md) instead.
- Keep pull requests focused. Separate unrelated refactors from feature work.

## Development setup

Requirements:

- Node.js 20.19+ and npm.
- Rust stable with `rustfmt` and `clippy`.
- The platform prerequisites for Tauri 2. See the
  [README requirements](README.md#requirements).
- For iOS: macOS with Xcode 15+ and CocoaPods. See [docs/IOS.md](docs/IOS.md).
- For Android: JDK 17 and the Android SDK. See
  [docs/ANDROID.md](docs/ANDROID.md).

Clone your fork, then from the repository directory:

```bash
npm install
npm run tauri dev
```

The first launch downloads the creator index in the background. It is stored
locally and reused on later launches.

## Quality checks

Run the relevant checks before opening a pull request:

```bash
# Frontend
npm run typecheck
npm run lint
npm run test
npm run build

# Rust backend
cd src-tauri
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For Android changes:

```bash
npm run android:doctor
npm run android:build -- --debug --target aarch64
```

For iOS changes, build and launch the simulator app with `npm run ios`.

## Coding guidelines

- Match the existing TypeScript, React and Rust style. Keep components small
  and reuse the existing UI primitives.
- Keep the frontend/backend boundary typed through `src/services/api.ts` and
  the Tauri commands.
- Validate URLs, paths and remote HTML in the Rust backend, not only in React.
- Do not add a dependency unless it is clearly necessary and maintained.
- Preserve the existing security posture: HTTPS-only remote requests, host
  allowlisting, sanitized HTML, strict CSP and a minimal Tauri capability set.
- Do not commit generated build output, APKs, DMGs, IPAs, keystores,
  provisioning profiles or credentials.
- Update the README and `docs/` when behavior, setup or platform support
  changes.

## Commit and pull-request guidelines

- Use a short, descriptive commit subject in the imperative mood, for example
  `Fix settings toggle races` or `Add Android build scripts`.
- Explain the motivation and user-visible impact in the pull-request
  description.
- Include reproduction steps and the platforms you tested.
- Add or update tests for behavior changes.
- Include screenshots or recordings for UI changes.
- Keep generated files (for example `src-tauri/gen/android`) in sync when the
  Android configuration changes.

## Platform testing

At minimum, test the platform you changed. When a change touches shared UI or
navigation, also verify desktop and at least one mobile target. Useful checks:

- Home, Discover, Search, a creator profile and a post.
- Playlist creation, queueing and playback.
- Download a single file, a post and a playlist; cancel one download.
- Settings toggles and persistence after restart.
- Back navigation, scroll restoration and the image viewer.
- Android hardware back and iOS edge-swipe navigation.

## Releases

Desktop release bundles are built by
[`.github/workflows/release.yml`](.github/workflows/release.yml). Android builds
are checked by [`.github/workflows/android.yml`](.github/workflows/android.yml).
See [docs/PACKAGING.md](docs/PACKAGING.md) for signing and release details.

## License

By contributing, you agree that your contributions are licensed under the
MIT License in [LICENSE](LICENSE).
