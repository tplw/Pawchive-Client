# Performance Notes

Performance is a release requirement, not an afterthought. This document keeps
the measurement method and a checklist so regressions can be compared across
builds.

## Built-in instrumentation

In development builds (`npm run tauri dev`) the frontend records lightweight
timings and prints them to the webview console:

- `[pawchive:perf] navigation <route> <ms>` — time between route changes.
- `[pawchive:perf] search results <ms>` — time from a debounced query change to
  the first result page.

Open the webview inspector (right-click → Inspect, or the platform developer
tools) and filter the console for `pawchive:perf`. The instrumentation is
compiled out of release behavior and never sends data anywhere.

The Rust backend logs startup and network activity when run with:

```bash
PAWCHIVE_LOG=debug npm run tauri dev
```

Useful log lines include the application data directory, creator index count
and HTTP connection reuse. Do not leave verbose logging enabled in release.

## Metrics to record

Record the following on each platform before a release. Use the same hardware,
network and dataset for comparisons.

| Metric | Method | Target / notes |
| ------ | ------ | -------------- |
| Startup | Time from process launch to the first `frontend requested configuration` debug log | Should remain under ~2 s on an SSD; the creator index sync runs in the background and must not block the UI. |
| Navigation | `[pawchive:perf] navigation` marks | No visible jank; route changes should be well under 100 ms excluding network. |
| Search | `[pawchive:perf] search results` marks | Debounce is 350 ms; measure the network + IPC portion after the debounce. |
| Scrolling | DevTools Performance panel while scrolling Discover/Creators | Virtualized grids should keep DOM node counts roughly constant as the list grows. |
| Thumbnail rendering | DevTools Network + Performance | Images are lazy (`loading="lazy"`, `decoding="async"`) and served with a long `Cache-Control` by the image host. Repeat visits should hit the webview cache. |
| Memory | DevTools Memory → heap snapshot after browsing 20+ posts and playing media | Memory should plateau rather than grow with every page. Media is streamed, not buffered in the backend. |
| Media playback | Play an MP4 and an MP3, seek repeatedly, toggle fullscreen and expand | No long stalls; Range requests return `206`; unsupported containers show a clear error. |

## How to measure

### Frontend

1. Run `npm run tauri dev`.
2. Open the webview inspector.
3. In the console, watch the `[pawchive:perf]` logs.
4. For scrolling, start a Performance recording, scroll through several pages,
   then inspect long tasks and layout counts.
5. For memory, take a heap snapshot before and after loading several pages and
   starting playback.

### Backend

1. Run `PAWCHIVE_LOG=debug npm run tauri dev`.
2. Check the startup log for the data directory and version.
3. Watch for retries, 429 handling and request errors.
4. The API cache is bounded (512 entries, 64 MB by default) and uses short
   TTLs (45–300 seconds) depending on the endpoint.

### Media Range support

The file host supports byte ranges. Verify a media URL with:

```bash
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" \
  "https://file.pawchive.pw/data/<path>"
```

A `206 Partial Content` response with `Content-Range` confirms seeking support.
The player relies on the system webview's media engine for the actual request.

## Release checklist

- [ ] Startup does not wait for the creator index.
- [ ] Scrolling Discover/Creators keeps the DOM bounded.
- [ ] Search debounce works and stale requests are cancelled.
- [ ] Thumbnails are lazy and cached across navigation.
- [ ] Loading 20+ posts does not grow memory without bound.
- [ ] Audio keeps playing while navigating between pages.
- [ ] Video expands/fullscreen without restarting playback.
- [ ] Resume position is restored after reopening a media file.
- [ ] Unsupported codecs show a useful error, not a silent failure.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` and the frontend
      quality suite pass.

## Known trade-offs

- Virtualized grids use fixed row heights so the scrollbar is stable. Cards use
  line clamps; unusually long titles are truncated rather than expanding a row.
- The creator index is a one-time 15 MB download. It is intentionally stored in
  SQLite so every later search is instant and does not hit the network.
- API responses are cached in memory only. Previously loaded pages remain
  usable during the session; a restart re-fetches from the archive.
