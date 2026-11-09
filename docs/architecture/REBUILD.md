# Pawchive Client Rebuild Blueprint

Status: **proposed**. This document fixes the target shape before any behavior-changing
code moves. The app stays on Tauri 2, Rust, React, TypeScript and the current UI.

## Goal

Make the code easy to understand without losing any core function:

- browsing, creator profiles, posts, search and filters
- playback, queue, image viewer and progress
- downloads, retries, playlists, caching and transcoding
- MEGA, Google Drive, Dropbox and GoFile media
- settings, creator filters, blocked creators, account and updates

The rebuild is incremental. Working behavior is never deleted before its replacement
passes the existing tests and a manual smoke check.

## Evidence from the current code

| Area | Current problem |
| --- | --- |
| Frontend | 67 TS/TSX files, ~14.4k lines. `Player.tsx` is 1,512 lines, `PostDetail.tsx` 969, `CreatorProfile.tsx` 810. |
| Backend | 25 Rust files, ~12.8k lines. `commands.rs` is 1,764 lines and mixes IPC, use cases, persistence, network probing and platform code. |
| State | `AppState` is a 14-field service locator passed to nearly every module. |
| Models | `models.rs` mixes wire DTOs, UI DTOs, archive policy, HTML helpers and provider-specific logic. |
| Media | Provider branching is repeated in `get_post`, `resolve_media`, downloads, cache, transcode and size/dimension probes. |
| UI | Feature behavior is spread across `pages/`, `components/`, `player/`, `stores/` and `services/`; no feature has one owner. |
| Shell | `App.tsx` owns routing, startup, scroll restore, downloads events, gestures and shortcuts. |
| Tests | 18 test files. They mock the aggregate `api` object and cover many flows, but there are few characterization tests around cache invalidation, conversions and the app shell. |

## Chosen architecture

**Sketch A: feature slices over a small shared kernel.**

- Frontend: `app/` shell, `shared/` infrastructure, `features/` vertical slices with one public `index.ts`.
- Backend: modular monolith by feature. Tauri commands stay thin at the boundary; each feature owns its service/use cases. Shared infrastructure (SQLite, Pawchive API, providers, loopback HTTP) lives under `infra/`.
- No new runtime dependencies.
- No behavior, route, command, event, storage-key or CSS-contract changes during migration.

### Frontend target tree

```text
src/
  app/
    App.tsx
    providers/QueryProvider.tsx
    bootstrap/useBootstrap.ts
    routes/{RoutePage.tsx,routes.ts}
    navigation/{useHashSync.ts,useScrollRestoration.ts,useGlobalShortcuts.ts,useAndroidBack.ts,useMobileEdgeSwipe.ts}
    shell/{AppShell.tsx,ErrorBoundary.tsx,Sidebar.tsx,TopBar.tsx,MobileTabBar.tsx,Toaster.tsx}
  shared/
    api/{invoke.ts,cancellable.ts,localMediaUrl.ts}
    query/{client.ts,keys.ts,invalidation.ts,pagination.ts}
    ui/{Button.tsx,IconButton.tsx,Badge.tsx,EmptyState.tsx,Field.tsx,Modal.tsx,ConfirmDialog.tsx,Toggle.tsx,Skeleton.tsx,SectionHeader.tsx,CardGrid.tsx}
    lib/{format.ts,platform.ts,window.ts,orientation.ts,useDebouncedValue.ts,useInView.ts,perf.ts}
    types/{api.ts,media.ts,creator.ts,post.ts,playlist.ts,download.ts,settings.ts,route.ts}
  features/
    posts/{api.ts,model/,ui/,index.ts}
    creators/{api.ts,model/,ui/,index.ts}
    search/{api.ts,model/,ui/,index.ts}
    playlists/{api.ts,model/,ui/,index.ts}
    downloads/{api.ts,model/,ui/,index.ts}
    media/{model/,ui/,index.ts}
    player/{model/,ui/,index.ts}
    settings/{api.ts,model/,ui/,index.ts}
    account/{api.ts,model/,ui/,index.ts}
    updates/{api.ts,model/,ui/,index.ts}
  styles/index.css
```

Public exports are the only cross-feature seam:

```ts
// features/posts/index.ts
export { DiscoverPage, PostDetailPage } from "./ui";
export { PostCard, PostCardSkeleton } from "./ui/PostCard";
export { usePostDetail, usePostFeeds } from "./model";

// features/creators/index.ts
export { CreatorsPage, CreatorProfilePage } from "./ui";
export { CreatorCard, CreatorCardSkeleton } from "./ui/CreatorCard";
export { useBlockedCreators, useCreatorFilter } from "./model";

// features/media/index.ts
export { ImageViewer, MediaThumbnail } from "./ui";
export { providerForUrl, needsMediaResolution, isMegaFileUrl } from "./model/providers";
export { attachmentFromPlaylistItem, attachmentFromDownload } from "./model/attachments";

// features/player/index.ts
export { Player } from "./ui";
export { usePlayerStore } from "./model/store";
export { toQueueItemFromAttachment, toQueueItemFromPlaylistItem, toQueueItemFromDownload } from "./model/queue";

// features/downloads/index.ts
export { DownloadsPage } from "./ui";
export { useDownloadEvents, useDownloadActions } from "./model";
```

Shared query keys remove the repeated literals without changing cache behavior:

```ts
export const queryKeys = {
  downloads: () => ["downloads"] as const,
  posts: () => ["posts"] as const,
  post: (s: string, c: string, p: string) => ["post", s, c, p] as const,
  creator: (s: string, c: string) => ["creator", s, c] as const,
  creatorPosts: (s: string, c: string, q: string) => ["creator-posts", s, c, q] as const,
  creators: () => ["creators"] as const,
  search: (q: string, service: string, media: string[], sort: string) =>
    ["search", q, service, media, sort] as const,
  playlists: () => ["playlists"] as const,
  playlistItems: (id?: number) =>
    id == null ? (["playlist-items"] as const) : (["playlist-items", id] as const),
};
```

### Backend target tree

```text
src/
  main.rs
  lib.rs                         # builder + handler registration
  app/
    bootstrap.rs                 # dirs, migrations, logging, cleanup
    state.rs                     # AppState of service handles
    services.rs                  # concrete service construction
  shared/
    error.rs
    config.rs
    version.rs
    logging.rs
    media_kind.rs
    cancellation.rs
    security/{url.rs,dns.rs,redirect.rs,validate.rs,filename.rs,html.rs}
    net/{http.rs,probe.rs,stream.rs}
  features/
    settings/{commands.rs,service.rs}
    updates/{commands.rs,service.rs}
    system/{commands.rs}
    account/{commands.rs,service.rs,store.rs}
    creators/{commands.rs,service.rs,query.rs}
    posts/{commands.rs,service.rs,attachments.rs,summary.rs,folder.rs}
    search/{commands.rs,service.rs,ranking.rs}
    favorites/{commands.rs,service.rs}
    playlists/{commands.rs,service.rs}
    downloads/{commands.rs,queue.rs,worker.rs,sources.rs,service.rs}
    media/{commands.rs,service.rs,probe.rs,cache.rs,transcode.rs,subtitles.rs}
  infra/
    pawchive_api/{client.rs,cache.rs,endpoints.rs,html.rs}
    sqlite/{db.rs,migrations.rs,settings_repo.rs,creator_repo.rs,library_repo.rs,download_repo.rs,progress_repo.rs}
    providers/{mega/{link.rs,crypto.rs,api.rs,resolver.rs,stream.rs},drive.rs,dropbox.rs,gofile.rs,probe.rs}
    local_http/{server.rs,request.rs,range.rs,mime.rs,sources.rs}
    ffmpeg.rs
  ipc/
    events.rs                    # Tauri event sink
    commands.rs                  # thin wrappers, registered exactly as today
```

Public service contracts:

```rust
pub struct MediaService { /* config, HTTP, MEGA, remote, loopback server, cache, settings */ }
impl MediaService {
    pub async fn resolve(&self, url: &str) -> AppResult<ResolvedMediaInfo>;
    pub async fn size(&self, url: &str) -> AppResult<Option<u64>>;
    pub async fn image_dimensions(&self, url: &str) -> AppResult<Option<MediaDimensions>>;
    pub async fn cache(&self, url: &str, request_id: Option<&str>) -> AppResult<String>;
    pub async fn transcode(&self, url: &str, request_id: Option<&str>) -> AppResult<String>;
    pub fn local_url(&self, path: &Path) -> AppResult<String>;
}

pub struct PostService { /* API, DB, config, MediaService, settings */ }
impl PostService {
    pub async fn recent(&self, offset: i64, request_id: Option<&str>) -> AppResult<PostPage>;
    pub async fn detail(&self, service: &str, creator: &str, post: &str, request_id: Option<&str>) -> AppResult<PostDetail>;
    pub async fn summary(&self, service: &str, creator: &str, post: &str) -> AppResult<PostSummary>;
}

pub struct DownloadService { /* DB, settings, MediaService, gate, dirs, EventSink */ }
impl DownloadService {
    pub async fn enqueue(&self, request: DownloadRequest) -> AppResult<DownloadRecord>;
    pub async fn download_post(&self, service: &str, creator: &str, post: &str) -> AppResult<u64>;
    pub async fn cancel(&self, id: &str) -> AppResult<()>;
}

pub trait EventSink: Send + Sync {
    fn download_progress(&self, record: &DownloadRecord);
    fn transcode_progress(&self, request_id: Option<&str>, progress: f64);
    fn media_cache_progress(&self, request_id: Option<&str>, downloaded: u64, total: Option<u64>);
    fn creators_synced(&self, count: i64);
}

pub struct AppState {
    pub settings: SettingsService,
    pub creators: CreatorService,
    pub posts: PostService,
    pub media: MediaService,
    pub downloads: DownloadService,
    pub library: LibraryService,
    pub account: AccountService,
    pub cancellations: CancellationRegistry,
}
```

Commands stay one-liners so the frontend and `tauri::generate_handler!` list remain unchanged:

```rust
#[tauri::command]
pub async fn get_post(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<PostDetail> {
    state.posts.detail(&service, &creator_id, &post_id, request_id.as_deref()).await
}
```

## Rejected sketch B

**Layered frontend + hexagonal backend.**

- Frontend: `pages/`, `widgets/`, `components/`, `hooks/`, `stores/`, `services/`, `domain/`.
- Backend: `domain/`, `application/ports`, `application/use_cases`, `adapters/`, `tauri/`.

Why rejected:

- It moves files but leaves each product flow spread across five technical folders.
- The backend would need async traits, boxed futures and many service generics for a single app with one archive API and one SQLite database.
- It does not address the real hot spots: `commands.rs` orchestration and the lack of feature ownership.
- It is a useful intermediate style for pure hooks/adapters, but the final shape should be feature slices.

## Non-negotiable contracts

These stay identical throughout the migration:

- 60 Tauri command names, parameters and camelCase DTO shapes.
- `AppError` `{ code, message, retryable }` values.
- Tauri events: `download://progress`, `download://complete`, `download://error`,
  `transcode://progress`, `media-cache://progress`, `creators://synced`.
- Hash routes and tab stacks, including the post-detail remount key and search-no-remount behavior.
- `#main-scroll`, `[data-modal-open="true"]`, `pawchive:*` window events and
  `.app-shell`, `.main-scroll`, `.content-row`, `.player-bar` CSS contracts.
- `localStorage` keys `pawchive-player`, `pawchive-creator-filter:*` and
  `sessionStorage` key `pawchive-scroll-positions`.
- One persistent `<video>` element mounted at the app shell.
- MEGA-first provider resolution, deferred/preview-only attachment rules, cache
  directory and hashed cache filenames.
- DB writes on `spawn_blocking`; append-only migrations.
- Pagination constants 50 posts and 60 creators until a deliberate behavior change.

## Progress

- **Phase 0+1 complete** (`97ffc54`): contract inventory, query-key and
  pagination helpers, download progress merging, media provider/attachment
  adapters, backend shared media-kind module, and post-summary extraction.
  Typecheck, lint, tests, clippy and production build are green.
- **Phase 2 complete:** `Player.tsx` is split into feature hooks
  (`useMediaSource`, `usePlaybackProgress`, `useTranscode`, `useFullscreen`,
  `useMediaSession`, `usePlayerKeyboard`, `useSeekEvent`) and feature UI
  (`Controls`, `Stage`, `Queue`). `ImageViewer.tsx` delegates source loading,
  gestures and keyboard/focus handling to `features/media/model`. The backend
  gained `features/media/MediaService` for `resolve_media`, `get_media_size`
  and `get_image_dimensions`; Tauri command signatures are unchanged.
- **Next:** Phase 3, posts, creators and search.

## Migration phases

Each phase is a separate commit series. No phase changes UI or behavior unless its
acceptance check explicitly says so.

### Phase 0 — Baseline and guardrails

- Inventory all 60 commands, events, routes, storage keys and CSS contracts.
- Run and record the current `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`
  and `cargo test`.
- Add characterization tests for the riskiest seams: download event cache patches,
  `DownloadRecord`/`PlaylistItem` to attachment/queue conversions, pagination
  dedupe, and route/tab-stack behavior.

**Acceptance:** full checks green; no code moved.

### Phase 1 — Shared foundations

Frontend:

- Add `shared/query/keys.ts` and `shared/query/pagination.ts`; replace query-key
  literals one feature at a time. Keep the same key arrays.
- Add `shared/types/` and re-export from `types.ts` during the transition.
- Move provider classification and attachment conversions to `features/media/model`
  with re-export shims in their old paths.

Backend:

- Create `shared/media_kind.rs`, `shared/cancellation.rs`, `shared/security/` and
  `shared/net/`; re-export old paths from `models.rs`, `security.rs` and `media.rs`.
- Break the `security ↔ models` cycle first.
- Extract pure helpers from `commands.rs` (`creator_lookup`, `thumbnail_for_file`,
  `build_post_page`, update-version parsing) without changing command bodies.

**Acceptance:** no behavior change; all checks green.

### Phase 2 — Media and player

- Backend: introduce `features/media/MediaService`; route `get_post` attachment
  enrichment, `resolve_media`, `get_media_size`, `get_image_dimensions`, downloads,
  cache and transcode through it. Keep provider order and headers identical.
- Frontend: split `Player.tsx` into `features/player/{ui,model}`:
  `PlayerBar`, `PlayerStage`, `PlayerControls`, `QueuePanel`, `QueueList`;
  `useMediaSource`, `usePlaybackProgress`, `useFullscreen`, `useMediaSession`,
  `usePlayerKeyboard`, `useTranscode`. Keep one `<video>` and the persisted key.
- Split `ImageViewer` loading/caching and gestures into hooks under `features/media`.

**Acceptance:** playback, seeking, resume, queue persistence, downloads, cache and
transcode smoke tests pass on desktop; image viewer swipe/zoom/cache still works.

### Phase 3 — Posts, creators and search

- Backend: `PostService`, `CreatorService`, `SearchService`; move `get_post`,
  post lists, comments/revisions, popular, creator profile/links/announcements,
  similar creators and search orchestration out of `commands.rs`.
- Frontend: split `PostDetail`, `CreatorProfile`, `Discover`, `Creators` and
  `Search` into feature `ui/` and `model/` modules. Move `cards.tsx` into
  creator/post UI files with re-export shims.
- Move duplicate page flattening/dedupe and blocked-creator filtering into shared
  helpers.

**Acceptance:** all list/detail/search/filter/blocking smoke tests pass; query keys
and pagination are unchanged.

### Phase 4 — Downloads, playlists, settings, account and updates

- Backend: `DownloadService`, `LibraryService`, `SettingsService`,
  `AccountService`, `UpdateService`.
- Frontend: split `Downloads`, `Playlist`, `Home`, `Settings`, `PlaylistPicker`
  and `UpdateDialog` into feature modules; centralize download initiation and
  invalidation.
- Keep event names, payloads, toasts and optimistic settings behavior identical.

**Acceptance:** download/cancel/retry/clear, playlist cover, settings rollback,
account and update flows pass.

### Phase 5 — App shell and stores

- Split `App.tsx` into `useBootstrap`, `RoutePage`, `useHashSync`,
  `useScrollRestoration`, `useGlobalShortcuts`, `useAndroidBack`,
  `useMobileEdgeSwipe`, `useDownloadEvents` and shell components.
- Split `stores/app.ts` into settings, navigation, toasts, updates and creator-index
  stores. Keep a compatibility facade during migration.
- Replace the router module side-effect with explicit bootstrap wiring.

**Acceptance:** every route, tab stack, back gesture, scroll restore, modal and
player shortcut behaves exactly as before.

### Phase 6 — Infrastructure and cleanup

- Split `db.rs`, `models.rs`, `mega.rs`, `remote_media.rs`, `local_media.rs`,
  `downloads.rs`, `media_cache.rs` and `transcode.rs` under `infra/`.
- Delete re-export shims and dead types. Grep for `not implemented`.
- Update `README.md` project structure.

**Acceptance:** full checks, production build, and the manual smoke checklist pass.
No command/event/route/storage changes.

## Debugging and verification protocol

For every change:

1. Add or update a focused test before moving behavior.
2. Run the narrow check first, then the full gate:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test -- --run`
   - `npm run build`
   - `cargo fmt --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace`
3. Run the manual smoke path for the touched feature:
   Home → Discover → Search → creator → post → play/seek/resume → image viewer →
   queue → playlist → download/cancel/retry → settings → back navigation.
4. Compare command payloads, event payloads and storage keys against the Phase 0
   inventory.
5. If a sketch needs three revisions during implementation, stop and redesign it
   with the user instead of patching around it.

## First implementation slice

After approval, start with **Phase 0 + Phase 1 only**:

- record the contracts and run the baseline
- add characterization tests for download events, conversions and pagination dedupe
- introduce shared query keys/pagination and backend shared media-kind/security modules
- prove zero behavior change with the full checks

Do not begin with the player or `commands.rs`; they are the highest-risk slices and
should land after the guardrails and shared seams exist.
