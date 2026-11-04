# Player Engine Evaluation

The player is a core feature. This note records why the implementation uses the
platform webview's media engine instead of bundling a native engine.

## Options considered

### Platform webview (selected)

- **How**: a single `<video>` element lives in the app shell and is reused for
  both audio and video. The Rust backend validates the media URL; the webview
  streams it with its native HTTP stack and Range support.
- **Licensing**: no additional media libraries are shipped; the engine is part
  of the operating system.
- **Packaging**: no extra binaries, frameworks or codec packs. App size stays
  small and updates follow the OS.
- **Compatibility**: strong for MP4/H.264, WebM, MP3, AAC, FLAC, WAV and, on
  most platforms, OGG/Opus. MKV/AVI support depends on the platform and is not
  advertised as guaranteed.
- **Trade-offs**: codec support is not fully under our control. The app reports
  unsupported containers clearly instead of silently failing.

### libmpv

- **Pros**: very broad container/codec support, hardware decoding, subtitles.
- **Cons**: large native binaries per platform, complex cross-platform
  packaging, GPU/context integration with Tauri, and additional licensing and
  distribution obligations. It would be disproportionate for a lightweight
  browser client.
- **Decision**: not bundled.

### GStreamer

- **Pros**: mature, LGPL, good Linux integration; the AppImage can bundle a
  media framework.
- **Cons**: cross-platform packaging is heavy, Windows/macOS integration needs
  extra plugins and runtime paths, and the webview already covers the common
  formats.
- **Decision**: not bundled as a separate engine. Linux builds still rely on
  the system GStreamer stack (and the AppImage's bundled media framework).

## Consequences

- Playback is streamed; the backend never downloads a whole media file into
  memory.
- Seeking depends on the file host's HTTP Range support. The host answers
  ranged requests with `206 Partial Content`.
- The player exposes clear buffering and unsupported-codec errors, plus a
  retry action.
- Subtitles are limited to user-selected `.srt`/`.vtt` files, converted to
  WebVTT in Rust and attached as a local blob track.
- Expand/collapse, speed, volume, mute, queue and previous/next attachment are
  implemented in the React player. The expanded view places the seek bar and
  controls along the bottom, like the site's Plyr player. Fullscreen uses the
  Tauri window's fullscreen state so it works consistently across webviews.

## Verification

Automated checks cover URL validation, subtitle conversion, player state and
resume-position behavior. Actual decode support is verified manually per
platform using the smoke-test checklist in
[PACKAGING.md](PACKAGING.md). Unsupported files should be opened in a dedicated
media player.
