use crate::config::{PawchiveConfig, PAGE_SIZE};
use crate::error::{AppError, AppResult};
use crate::features::posts::summary::{build_post_page, creator_lookup, post_thumbnail};
use crate::models::{
    now_ts, AccountSession, AccountState, Announcement, AppSettings, Attachment, Comment,
    CreatorPage, CreatorProfile, CreatorSummary, DownloadRecord, DownloadRequest, MediaKind,
    PlaybackProgress, Playlist, PlaylistItem, PostDetail, PostPage, PostSummary, Revision,
    SearchPage,
};
use crate::security::{sanitize_html, validate_search_query, validate_service};
use crate::state::AppState;
use reqwest::cookie::CookieStore;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

fn st(state: &State<'_, AppState>) -> AppState {
    state.inner().clone()
}

async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("background task failed: {e}")))?
}

/* ------------------------------- settings ------------------------------- */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> AppResult<AppSettings> {
    let st = st(&state);
    let mut seen = std::collections::HashSet::new();
    settings.hidden_keywords = settings
        .hidden_keywords
        .into_iter()
        .map(|keyword| keyword.trim().to_string())
        .filter(|keyword| !keyword.is_empty())
        .filter(|keyword| seen.insert(keyword.to_lowercase()))
        .take(100)
        .collect();
    settings.validate()?;
    let saved = settings.clone();
    let db = Arc::clone(&st.db);
    blocking(move || db.save_settings(&saved)).await?;
    st.api.set_cache_size_mb(settings.cache_size_mb);
    if let Ok(mut current) = st.settings.write() {
        *current = settings.clone();
    }
    Ok(settings)
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> PawchiveConfig {
    tracing::debug!("frontend requested configuration");
    state.cfg.clone()
}

const UPDATES_API: &str = "https://api.github.com/repos/tplw/Pawchive-Client/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/tplw/Pawchive-Client/releases";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    update_available: bool,
    url: String,
    release_name: Option<String>,
}

/// Parse a release version with two to four numeric segments. Release tags
/// such as `v1.0.3.1` are valid Pawchive versions even though Cargo and Tauri
/// only accept three numeric segments.
fn parse_version(input: &str) -> AppResult<Vec<u64>> {
    let raw = input.trim().trim_start_matches('v');
    let core = raw.split(['-', '+']).next().unwrap_or(raw);
    let mut parts = Vec::new();
    for part in core.split('.') {
        parts.push(
            part.parse::<u64>()
                .map_err(|_| AppError::InvalidResponse(format!("invalid version: {input}")))?,
        );
    }
    if !(2..=4).contains(&parts.len()) {
        return Err(AppError::InvalidResponse(format!(
            "invalid version: {input}"
        )));
    }
    while parts.len() < 4 {
        parts.push(0);
    }
    Ok(parts)
}

fn is_newer_version(current: &str, latest: &str) -> AppResult<bool> {
    Ok(parse_version(latest)? > parse_version(current)?)
}

#[tauri::command]
pub async fn check_for_update(state: State<'_, AppState>) -> AppResult<UpdateInfo> {
    let response = state
        .http
        .get(UPDATES_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Network(format!("could not check for updates: {e}")))?;

    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err(AppError::Unavailable(
            "GitHub is rate limiting update checks; try again later".into(),
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::Unavailable(format!(
            "update service returned {}",
            response.status()
        )));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::InvalidResponse(format!("invalid update response: {e}")))?;
    let latest = payload
        .get("tag_name")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::InvalidResponse("release has no tag name".into()))?;
    let latest = latest.trim_start_matches('v');
    let update_available = is_newer_version(crate::version::APP_VERSION, latest)?;
    let url = payload
        .get("html_url")
        .and_then(|value| value.as_str())
        .filter(|url| url.starts_with("https://github.com/tplw/Pawchive-Client/releases/"))
        .unwrap_or(RELEASES_PAGE);
    let release_name = payload
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    Ok(UpdateInfo {
        current_version: crate::version::APP_VERSION.to_string(),
        latest_version: latest.to_string(),
        update_available,
        url: url.to_string(),
        release_name,
    })
}

#[tauri::command]
pub fn open_external(url: String) -> AppResult<()> {
    let url = crate::security::validate_external_url(&url)?;
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::Io(format!("could not open the link: {e}")))
}

/// Hide or restore the iOS status bar while the player is immersive.
///
/// The generated iOS project sets `UIViewControllerBasedStatusBarAppearance`
/// to `false`, so the app-level status bar state is authoritative.
#[tauri::command]
pub fn set_status_bar_hidden(app: tauri::AppHandle, hidden: bool) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_ui_kit::UIApplication;

            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let application = UIApplication::sharedApplication(mtm);
            #[allow(deprecated)]
            application.setStatusBarHidden_animated(hidden, false);
        })
        .map_err(|error| AppError::Internal(error.to_string()))?;
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, hidden);
    }
    Ok(())
}

/* ------------------------------- creators ------------------------------- */

#[tauri::command]
pub async fn sync_creators(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: Option<String>,
) -> AppResult<i64> {
    let st = st(&state);
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st.api.list_creators(token.as_ref()).await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    let creators = result?;
    if creators.is_empty() {
        return Err(AppError::InvalidResponse(
            "the archive returned an empty creator index".into(),
        ));
    }
    let db = Arc::clone(&st.db);
    let count = blocking(move || db.sync_creators(&creators)).await?;
    st.db
        .set_raw_setting("creators_synced_at", &now_ts().to_string())?;
    st.db.set_raw_setting("creators_import_state_synced", "1")?;
    let _ = app.emit("creators://synced", count);
    Ok(count as i64)
}

#[tauri::command]
pub async fn get_creator_count(state: State<'_, AppState>) -> AppResult<i64> {
    let st = st(&state);
    // Creator rows that predate import-state tracking were migrated with
    // `ever_imported = 1`. Force one refresh so cards stop treating archived
    // and unimported creators the same.
    if st
        .db
        .get_raw_setting("creators_import_state_synced")?
        .is_none()
    {
        return Ok(0);
    }
    let count = blocking(move || st.db.creator_count()).await?;
    tracing::debug!(count, "creator index count requested");
    Ok(count)
}

#[tauri::command]
pub async fn list_creators(
    state: State<'_, AppState>,
    query: Option<String>,
    service: Option<String>,
    sort: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> AppResult<CreatorPage> {
    let st = st(&state);
    let query = query.unwrap_or_default();
    let sort = sort.unwrap_or_else(|| "updated".into());
    let offset = offset.unwrap_or(0).max(0);
    let limit = limit.unwrap_or(60).clamp(1, 200);
    let service = service.filter(|s| !s.trim().is_empty());
    if let Some(service) = service.as_deref() {
        validate_service(service)?;
    }
    let db = Arc::clone(&st.db);
    let (items, total) =
        blocking(move || db.query_creators(&query, service.as_deref(), &sort, offset, limit))
            .await?;
    let settings = st.settings();
    let items: Vec<_> = items
        .into_iter()
        .filter(|creator| {
            !crate::filters::is_creator_blocked(&creator.service, &creator.id, &settings)
        })
        .collect();
    Ok(CreatorPage {
        items,
        offset,
        total,
        has_more: offset + limit < total,
        synced: total > 0,
    })
}

#[tauri::command]
pub async fn get_creator(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
) -> AppResult<Option<CreatorSummary>> {
    let st = st(&state);
    let service = validate_service(&service)?;
    let creator_id = crate::security::validate_id(&creator_id, "creator id")?;
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    blocking(move || st.db.get_creator(&service, &creator_id)).await
}

#[tauri::command]
pub async fn get_creator_profile(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<CreatorProfile> {
    let st = st(&state);
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .creator_profile(&service, &creator_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    result
}

#[tauri::command]
pub async fn get_creator_links(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<CreatorProfile>> {
    let st = st(&state);
    let settings = st.settings();
    if crate::filters::is_creator_blocked(&service, &creator_id, &settings) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .creator_links(&service, &creator_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    Ok(result?
        .into_iter()
        .filter(|item| !crate::filters::is_creator_blocked(&item.service, &item.id, &settings))
        .collect())
}

#[tauri::command]
pub async fn get_creator_announcements(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Announcement>> {
    let st = st(&state);
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .announcements(&service, &creator_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    Ok(result?
        .into_iter()
        .map(|mut item| {
            item.content = sanitize_html(&item.content);
            item
        })
        .collect())
}

#[tauri::command]
pub async fn get_creator_posts(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    offset: Option<i64>,
    query: Option<String>,
    request_id: Option<String>,
) -> AppResult<PostPage> {
    let st = st(&state);
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let offset = offset.unwrap_or(0);
    let query = query.filter(|value| !value.trim().is_empty());
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .creator_posts(
            &service,
            &creator_id,
            offset,
            query.as_deref(),
            token.as_ref(),
        )
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    build_post_page(&st, result?, offset)
}

#[tauri::command]
pub async fn get_similar_creators(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<CreatorSummary>> {
    let st = st(&state);
    let settings = st.settings();
    if crate::filters::is_creator_blocked(&service, &creator_id, &settings) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .similar_creators_html(&service, &creator_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    let items = crate::similar::parse_similar_creators(&result?);
    let hide_unavailable = settings.hide_unavailable_posts;
    let db = Arc::clone(&st.db);
    blocking(move || {
        Ok(items
            .into_iter()
            .map(|item| {
                db.get_creator(&item.service, &item.id)
                    .ok()
                    .flatten()
                    .unwrap_or(item)
            })
            .filter(|item| {
                !crate::filters::is_creator_blocked(&item.service, &item.id, &settings)
                    && (!hide_unavailable || item.ever_imported != Some(false))
            })
            .collect())
    })
    .await
}

/* --------------------------------- posts -------------------------------- */

/// Thumbnail lookups are best-effort. Remember failures for the rest of the
/// process so polling the Downloads page cannot hammer the API for posts that
/// simply do not contain an image.
static THUMBNAIL_ATTEMPTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn thumbnail_attempted(key: &str) -> bool {
    THUMBNAIL_ATTEMPTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|attempts| attempts.contains(key))
        .unwrap_or(false)
}

fn mark_thumbnail_attempted(key: &str) {
    if let Ok(mut attempts) = THUMBNAIL_ATTEMPTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
    {
        attempts.insert(key.to_string());
    }
}

#[tauri::command]
pub async fn get_recent_posts(
    state: State<'_, AppState>,
    offset: Option<i64>,
    request_id: Option<String>,
) -> AppResult<PostPage> {
    let st = st(&state);
    let offset = offset.unwrap_or(0);
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st.api.recent_posts(offset, None, token.as_ref()).await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    build_post_page(&st, result?, offset)
}

#[tauri::command]
pub async fn get_post_summary(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
) -> AppResult<PostSummary> {
    let st = st(&state);
    let post = st.api.post(&service, &creator_id, &post_id, None).await?;
    if crate::filters::is_creator_blocked(&post.service, &post.user, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let creator = st.db.get_creator(&post.service, &post.user)?;
    Ok(PostSummary::from_post(
        &st.cfg,
        &post,
        creator.map(|creator| creator.name),
    ))
}

#[tauri::command]
pub async fn get_post(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<PostDetail> {
    let st = st(&state);
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .post(&service, &creator_id, &post_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    let mut post = result?;
    if crate::filters::is_creator_blocked(&post.service, &post.user, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let next = post.next.clone();
    let prev = post.prev.clone();
    post.content = sanitize_html(&post.content);
    let attachments: Vec<Attachment> = post
        .all_files_including_direct()
        .into_iter()
        .filter_map(|file| Attachment::new(&st.cfg, &file))
        .collect();
    // Public Drive and MEGA folder links are expanded into their individual
    // files so they can be played, queued and downloaded like direct links.
    let mut attachments =
        crate::remote_media::expand_folders(&st.mega, &st.remote, attachments).await;
    // MEGA links hide their filename, size and media kind behind encrypted
    // attributes. Google Drive, Dropbox and GoFile links have no media
    // extension either. Resolve them now so the player queue and attachment
    // list classify them like any other archive file. Failures stay
    // non-fatal: the link is still visible and the player reports the error on
    // demand.
    for attachment in attachments.iter_mut() {
        if crate::mega::is_media_url(&attachment.url) {
            if let Ok(file) = st.mega.resolve(&attachment.url).await {
                attachment.name = file.name.clone();
                attachment.ext = crate::security::file_extension(&file.name);
                attachment.kind = file.kind();
                // Images need a real image URL for the thumbnail grid. Videos
                // and audio resolve to a loopback URL when the player opens
                // them.
                if attachment.kind == MediaKind::Image {
                    if let Some(link) = crate::mega::parse_file_link(&attachment.url) {
                        let stream = crate::mega::MegaStream::new(
                            st.mega.client_clone(),
                            link,
                            file.clone(),
                        );
                        attachment.thumbnail_url = Some(st.media_server.register_mega(stream));
                    }
                }
            }
        }
    }

    // Provider lookups can each take a second or two. Resolve them in
    // parallel (with a small concurrency cap) so a post full of Dropbox links
    // does not open one request at a time.
    let gate = Arc::new(tokio::sync::Semaphore::new(4));
    let mut jobs = tokio::task::JoinSet::new();
    for (index, attachment) in attachments.iter().enumerate() {
        if crate::mega::is_media_url(&attachment.url)
            || !crate::remote_media::needs_resolution(&attachment.url)
        {
            continue;
        }
        let state = st.clone();
        let url = attachment.url.clone();
        let gate = gate.clone();
        jobs.spawn(async move {
            let _permit = gate.acquire_owned().await.ok();
            (index, state.remote.resolve(&url).await.ok())
        });
    }
    while let Some(joined) = jobs.join_next().await {
        let Ok((index, Some(media))) = joined else {
            continue;
        };
        let Some(attachment) = attachments.get_mut(index) else {
            continue;
        };
        attachment.name = media.name.clone();
        attachment.ext = crate::security::file_extension(&media.name);
        attachment.kind = media.kind;
        attachment.provider = media.provider;
        if attachment.kind == MediaKind::Image {
            let source = media.source(st.remote.client().clone());
            attachment.thumbnail_url = Some(st.media_server.register_remote(source));
        }
    }
    let creator = st.db.get_creator(&post.service, &post.user)?.or_else(|| {
        Some(CreatorSummary {
            id: post.user.clone(),
            name: post.user.clone(),
            service: post.service.clone(),
            ..Default::default()
        })
    });
    Ok(PostDetail {
        post,
        attachments,
        creator,
        next,
        prev,
    })
}

#[tauri::command]
pub async fn get_post_comments(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Comment>> {
    let st = st(&state);
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .comments(&service, &creator_id, &post_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    Ok(result?
        .into_iter()
        .map(|mut comment| {
            comment.content = sanitize_html(&comment.content);
            for revision in &mut comment.revisions {
                revision.content = sanitize_html(&revision.content);
            }
            comment
        })
        .collect())
}

#[tauri::command]
pub async fn get_post_revisions(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Revision>> {
    let st = st(&state);
    if crate::filters::is_creator_blocked(&service, &creator_id, &st.settings()) {
        return Err(AppError::Blocked);
    }
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st
        .api
        .revisions(&service, &creator_id, &post_id, token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    Ok(result?
        .into_iter()
        .map(|mut revision| {
            revision.post.content = sanitize_html(&revision.post.content);
            revision
        })
        .collect())
}

#[tauri::command]
pub async fn get_popular_posts(
    state: State<'_, AppState>,
    offset: Option<i64>,
    request_id: Option<String>,
) -> AppResult<PostPage> {
    let st = st(&state);
    let offset = offset.unwrap_or(0);
    crate::security::validate_offset(offset)?;
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result = st.api.popular_posts_html(offset, token.as_ref()).await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    let html = result?;
    let mut items = crate::popular::parse_popular_posts(&html, |service, user| {
        st.db
            .get_creator(service, user)
            .ok()
            .flatten()
            .map(|creator| creator.name)
    });
    let has_more = items.len() as i64 >= PAGE_SIZE;
    let settings = st.settings();
    items.retain(|item| !crate::filters::summary_is_hidden(item, &settings));
    Ok(PostPage {
        items,
        offset,
        has_more,
    })
}

/* --------------------------------- search ------------------------------- */

#[tauri::command]
pub async fn search_all(
    state: State<'_, AppState>,
    query: String,
    offset: Option<i64>,
    service: Option<String>,
    media: Option<Vec<String>>,
    sort: Option<String>,
    request_id: Option<String>,
) -> AppResult<SearchPage> {
    let st = st(&state);
    let query = validate_search_query(&query)?;
    let offset = offset.unwrap_or(0);
    let sort = sort.unwrap_or_else(|| "relevance".into());
    let service = service.filter(|s| !s.trim().is_empty());
    if let Some(service) = service.as_deref() {
        validate_service(service)?;
    }
    let media_filter: Vec<MediaKind> = media
        .unwrap_or_default()
        .iter()
        .filter_map(|value| match value.as_str() {
            "image" => Some(MediaKind::Image),
            "video" => Some(MediaKind::Video),
            "audio" => Some(MediaKind::Audio),
            "document" => Some(MediaKind::Document),
            "other" => Some(MediaKind::Other),
            _ => None,
        })
        .collect();

    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let posts_result = st
        .api
        .recent_posts(offset, Some(&query), token.as_ref())
        .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    let raw_posts = posts_result?;
    let has_more = raw_posts.len() as i64 >= PAGE_SIZE;

    let mut limitations = Vec::new();
    let content_settings = st.settings();
    let mut filtered: Vec<PostSummary> = {
        let names = creator_lookup(&st, &raw_posts);
        raw_posts
            .iter()
            .filter(|post| {
                !crate::filters::is_hidden(
                    post,
                    names
                        .get(&(post.service.clone(), post.user.clone()))
                        .map(String::as_str),
                    &content_settings,
                )
            })
            .filter(|post| {
                service
                    .as_deref()
                    .map(|s| post.service.eq_ignore_ascii_case(s))
                    .unwrap_or(true)
            })
            .filter(|post| {
                if media_filter.is_empty() {
                    return true;
                }
                post.all_files_including_direct()
                    .iter()
                    .any(|file| media_filter.contains(&crate::models::media_kind_for_file(file)))
            })
            .map(|post| {
                PostSummary::from_post(
                    &st.cfg,
                    post,
                    names
                        .get(&(post.service.clone(), post.user.clone()))
                        .cloned(),
                )
            })
            .collect()
    };

    let lower = query.to_lowercase();
    let score = |post: &PostSummary| -> i64 {
        let mut value = 0;
        if post.title.to_lowercase().contains(&lower) {
            value += 10;
        }
        if post.excerpt.to_lowercase().contains(&lower) {
            value += 3;
        }
        if post
            .creator_name
            .as_deref()
            .map(|n| n.to_lowercase().contains(&lower))
            .unwrap_or(false)
        {
            value += 2;
        }
        value
    };

    match sort.as_str() {
        "oldest" => filtered.sort_by_key(|post| post.published.unwrap_or(i64::MAX)),
        "creator" => filtered.sort_by(|a, b| {
            a.creator_name
                .clone()
                .unwrap_or_default()
                .to_lowercase()
                .cmp(&b.creator_name.clone().unwrap_or_default().to_lowercase())
                .then_with(|| b.published.cmp(&a.published))
        }),
        "relevance" => filtered.sort_by(|a, b| {
            score(b)
                .cmp(&score(a))
                .then_with(|| b.published.cmp(&a.published))
        }),
        _ => filtered.sort_by_key(|post| std::cmp::Reverse(post.published)),
    }

    if service.is_some() {
        limitations.push(
            "Service filtering is applied locally to each page; the archive search has no service parameter."
                .to_string(),
        );
    }
    if !media_filter.is_empty() {
        limitations.push(
            "Media-type filtering is applied locally to the current page, so matching posts on later pages may not appear yet."
                .to_string(),
        );
    }
    if sort == "relevance" {
        limitations.push(
            "The archive does not expose a relevance score; relevance is calculated locally from title, excerpt and creator matches."
                .to_string(),
        );
    }

    let creators = {
        let db = Arc::clone(&st.db);
        let q = query.clone();
        blocking(move || db.query_creators(&q, None, "popular", 0, 12))
            .await?
            .0
    };

    Ok(SearchPage {
        posts: filtered,
        creators,
        offset,
        has_more,
        query,
        limitations,
    })
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, request_id: String) -> bool {
    state.cancel_request(&request_id)
}

/* ------------------------------ favorites ------------------------------ */

#[tauri::command]
pub async fn list_favorite_creators(state: State<'_, AppState>) -> AppResult<Vec<CreatorSummary>> {
    let st = st(&state);
    let settings = st.settings();
    let items = blocking(move || st.db.list_favorite_creators()).await?;
    Ok(items
        .into_iter()
        .filter(|creator| {
            !crate::filters::is_creator_blocked(&creator.service, &creator.id, &settings)
        })
        .collect())
}

#[tauri::command]
pub async fn set_favorite_creator(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    name: String,
    public_id: Option<String>,
    favorited: bool,
) -> AppResult<bool> {
    let st = st(&state);
    let service = validate_service(&service)?;
    let creator_id = crate::security::validate_id(&creator_id, "creator id")?;
    let db = Arc::clone(&st.db);
    let (s, id, n, p) = (
        service.clone(),
        creator_id.clone(),
        name.clone(),
        public_id.clone(),
    );
    blocking(move || db.set_favorite_creator(&s, &id, &n, p.as_deref(), favorited)).await?;
    if st.account_session().is_some() {
        if let Err(error) = st
            .api
            .set_account_favorite_creator(&service, &creator_id, favorited)
            .await
        {
            tracing::warn!(%error, "could not sync favorite with the account");
        }
    }
    Ok(favorited)
}

/* ------------------------------- playlists ------------------------------ */

#[tauri::command]
pub async fn list_playlists(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    let st = st(&state);
    blocking(move || st.db.list_playlists()).await
}

#[tauri::command]
pub async fn get_playlist(state: State<'_, AppState>, id: i64) -> AppResult<Playlist> {
    let st = st(&state);
    blocking(move || st.db.get_playlist(id))
        .await?
        .ok_or(AppError::NotFound)
}

#[tauri::command]
pub async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> AppResult<Playlist> {
    let st = st(&state);
    let description = description.unwrap_or_default();
    blocking(move || st.db.create_playlist(&name, &description)).await
}

#[tauri::command]
pub async fn rename_playlist(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<()> {
    let st = st(&state);
    let description = description.unwrap_or_default();
    blocking(move || st.db.rename_playlist(id, &name, &description)).await
}

#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let st = st(&state);
    blocking(move || st.db.delete_playlist(id)).await
}

#[tauri::command]
pub async fn list_playlist_items(
    state: State<'_, AppState>,
    playlist_id: i64,
) -> AppResult<Vec<PlaylistItem>> {
    let st = st(&state);
    let download_dir = st.download_dir();
    let db = Arc::clone(&st.db);
    let mut items = blocking(move || {
        let mut items = db.list_playlist_items(playlist_id)?;
        for item in &mut items {
            if let Some(local) = item.local_path.take() {
                // App containers can move between installs on iOS. Prefer the
                // current download folder when the recorded absolute path is
                // stale, falling back to the original path if it still exists.
                let current = std::path::Path::new(&local)
                    .file_name()
                    .map(|name| download_dir.join(name))
                    .filter(|path| path.exists());
                let original = std::path::Path::new(&local);
                item.local_path = current
                    .or_else(|| original.exists().then(|| original.to_path_buf()))
                    .map(|path| path.to_string_lossy().to_string());
            }
        }
        Ok(items)
    })
    .await?;

    for item in &mut items {
        if item.thumbnail_url.is_some() {
            continue;
        }
        if item.media_kind == "image" {
            item.thumbnail_url = Some(item.media_url.clone());
            let _ = st.db.set_playlist_item_thumbnail(item.id, &item.media_url);
            continue;
        }
        if item.media_kind == "video" || item.media_kind == "audio" {
            let attempt_key = format!("playlist-item:{}", item.id);
            if thumbnail_attempted(&attempt_key) {
                continue;
            }
            mark_thumbnail_attempted(&attempt_key);
            if let Ok(post) = st
                .api
                .post(&item.service, &item.creator_id, &item.post_id, None)
                .await
            {
                if let Some(thumbnail) = post_thumbnail(&st, &post) {
                    item.thumbnail_url = Some(thumbnail.clone());
                    let _ = st.db.set_playlist_item_thumbnail(item.id, &thumbnail);
                }
            }
        }
    }
    Ok(items)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_playlist_item(
    state: State<'_, AppState>,
    playlist_id: i64,
    service: String,
    creator_id: String,
    post_id: String,
    media_path: String,
    media_url: String,
    title: String,
    creator_name: String,
    thumbnail_url: Option<String>,
    media_kind: String,
) -> AppResult<PlaylistItem> {
    let st = st(&state);
    crate::media::validate_media_url(&st.cfg, &media_url)?;
    let item = PlaylistItem {
        id: 0,
        playlist_id,
        service,
        creator_id,
        post_id,
        media_path,
        media_url,
        title,
        creator_name,
        thumbnail_url,
        media_kind,
        added_at: now_ts(),
        local_path: None,
    };
    blocking(move || st.db.add_playlist_item(playlist_id, &item)).await
}

#[tauri::command]
pub async fn remove_playlist_item(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let st = st(&state);
    blocking(move || st.db.remove_playlist_item(id)).await
}

/* ------------------------------- downloads ------------------------------ */

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> AppResult<DownloadRecord> {
    let st = st(&state);
    crate::downloads::enqueue(&st, &app, request).await
}

#[tauri::command]
pub async fn download_post(
    app: AppHandle,
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
) -> AppResult<u64> {
    let st = st(&state);
    crate::downloads::download_post(&st, &app, &service, &creator_id, &post_id).await
}

#[tauri::command]
pub async fn download_playlist(
    app: AppHandle,
    state: State<'_, AppState>,
    playlist_id: i64,
) -> AppResult<u64> {
    let st = st(&state);
    crate::downloads::download_playlist(&st, &app, playlist_id).await
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let st = st(&state);
    crate::downloads::cancel(&st, &id).await
}

#[tauri::command]
pub async fn delete_download(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let st = st(&state);
    crate::downloads::delete(&st, &id).await
}

#[tauri::command]
pub async fn retry_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<DownloadRecord> {
    let st = st(&state);
    crate::downloads::retry(&st, &app, &id).await
}

#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> AppResult<u64> {
    let st = st(&state);
    crate::downloads::clear_completed(&st).await
}

#[tauri::command]
pub async fn clear_all_downloads(state: State<'_, AppState>) -> AppResult<u64> {
    let st = st(&state);
    crate::downloads::clear_all(&st).await
}

#[tauri::command]
pub async fn list_downloads(state: State<'_, AppState>) -> AppResult<Vec<DownloadRecord>> {
    let st = st(&state);
    let download_dir = st.download_dir();
    let db = Arc::clone(&st.db);
    let mut records = blocking(move || {
        let mut records = db.list_downloads()?;
        for record in &mut records {
            let original = std::path::Path::new(&record.file_path);
            if original.exists() {
                continue;
            }
            if let Some(name) = original.file_name() {
                let candidate = download_dir.join(name);
                if candidate.exists() {
                    record.file_path = candidate.to_string_lossy().to_string();
                }
            }
        }
        Ok(records)
    })
    .await?;

    let pending: Vec<DownloadRecord> = records
        .iter()
        .filter(|record| {
            record.thumbnail_url.is_none()
                && (record.media_kind == "video" || record.media_kind == "audio")
                && !thumbnail_attempted(&record.id)
        })
        .take(8)
        .cloned()
        .collect();
    for record in pending {
        mark_thumbnail_attempted(&record.id);
        if let Ok(post) = st
            .api
            .post(&record.service, &record.creator_id, &record.post_id, None)
            .await
        {
            if let Some(thumbnail) = post_thumbnail(&st, &post) {
                let _ = st.db.set_download_thumbnail(&record.id, &thumbnail);
                if let Some(target) = records.iter_mut().find(|entry| entry.id == record.id) {
                    target.thumbnail_url = Some(thumbnail);
                }
            }
        }
    }
    Ok(records)
}

#[tauri::command]
pub fn open_downloads_folder(state: State<'_, AppState>) -> AppResult<()> {
    let st = st(&state);
    let dir = st.download_dir();
    std::fs::create_dir_all(&dir)?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| AppError::Io(format!("could not open downloads folder: {e}")))
}

/* -------------------------------- account ------------------------------- */

fn account_file(state: &AppState) -> std::path::PathBuf {
    state.app_data_dir.join("account.json")
}

fn session_cookie(header: &str) -> Option<String> {
    header.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == "session" && !value.is_empty()).then(|| value.to_string())
    })
}

fn save_account(state: &AppState, session: &AccountSession) -> AppResult<()> {
    let path = account_file(state);
    let raw = serde_json::to_string_pretty(session)
        .map_err(|e| AppError::Internal(format!("could not serialize account: {e}")))?;
    std::fs::write(&path, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
    remember: Option<bool>,
) -> AppResult<AccountState> {
    let st = st(&state);
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 200 || password.is_empty() || password.len() > 500 {
        return Err(AppError::Validation("enter a username and password".into()));
    }
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .user_agent(&st.cfg.user_agent)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        .cookie_provider(jar.clone())
        .redirect(crate::security::redirect_policy(st.cfg.allowed_hosts()))
        .build()
        .map_err(|e| AppError::Internal(format!("could not build login client: {e}")))?;
    let login_url = format!("{}/account/login", st.cfg.static_base.trim_end_matches('/'));
    let response = client
        .post(&login_url)
        .form(&[
            ("username", username.as_str()),
            ("password", password.as_str()),
            ("location", "/"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Network(format!("could not reach Pawchive login: {e}")))?;
    if matches!(
        response.status(),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    ) {
        return Err(AppError::Unauthorized(
            "the username or password was rejected".into(),
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::Unauthorized(
            "Pawchive did not accept the login".into(),
        ));
    }
    let parsed = url::Url::parse(&login_url)?;
    let header = jar
        .cookies(&parsed)
        .and_then(|value| value.to_str().ok().map(str::to_string));
    let session = header
        .as_deref()
        .and_then(session_cookie)
        .ok_or_else(|| AppError::Unauthorized("the username or password was rejected".into()))?;

    let previous = st.account_session();
    st.api.set_session(Some(session.clone()));
    if st.api.list_account_favorites("artist", None).await.is_err() {
        st.api
            .set_session(previous.as_ref().map(|entry| entry.session.clone()));
        return Err(AppError::Unauthorized(
            "the account session could not be verified".into(),
        ));
    }
    let account = AccountSession { username, session };
    st.set_account(Some(account.clone()));
    if remember.unwrap_or(false) {
        save_account(&st, &account)?;
    } else {
        let path = account_file(&st);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(st.account_state())
}

#[tauri::command]
pub fn get_account_state(state: State<'_, AppState>) -> AccountState {
    state.account_state()
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> AppResult<AccountState> {
    let st = st(&state);
    st.api.set_session(None);
    st.set_account(None);
    let path = account_file(&st);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(AccountState::default())
}

#[tauri::command]
pub async fn sync_account_favorites(state: State<'_, AppState>) -> AppResult<u64> {
    let st = st(&state);
    if st.account_session().is_none() {
        return Err(AppError::Unauthorized("log in to sync favorites".into()));
    }
    let favorites = st.api.list_account_favorites("artist", None).await?;
    let db = Arc::clone(&st.db);
    let count = favorites.len() as u64;
    blocking(move || {
        for creator in &favorites {
            db.set_favorite_creator(
                &creator.service,
                &creator.id,
                &creator.name,
                creator.public_id.as_deref(),
                true,
            )?;
        }
        Ok(())
    })
    .await?;
    Ok(count)
}

/* ------------------------------- playback ------------------------------- */

#[tauri::command]
pub async fn save_progress(
    state: State<'_, AppState>,
    progress: PlaybackProgress,
) -> AppResult<()> {
    let st = st(&state);
    blocking(move || st.db.save_progress(&progress)).await
}

#[tauri::command]
pub async fn get_progress(
    state: State<'_, AppState>,
    file_path: String,
) -> AppResult<Option<PlaybackProgress>> {
    let st = st(&state);
    blocking(move || st.db.get_progress(&file_path)).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMediaInfo {
    /// Loopback URL that streams the file with Range support.
    pub url: String,
    pub name: String,
    pub size: u64,
    pub kind: MediaKind,
    pub provider: crate::providers::MediaProvider,
}

#[tauri::command]
pub async fn resolve_media(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<ResolvedMediaInfo> {
    let st = st(&state);
    if crate::mega::is_media_url(&url) {
        let link = crate::mega::parse_file_link(&url)
            .ok_or_else(|| AppError::Validation("not a MEGA file link".into()))?;
        let file = st.mega.resolve(&url).await?;
        let stream = crate::mega::MegaStream::new(st.mega.client_clone(), link, file.clone());
        let local_url = st.media_server.register_mega(stream);
        return Ok(ResolvedMediaInfo {
            url: local_url,
            name: file.name.clone(),
            size: file.size,
            kind: file.kind(),
            provider: crate::providers::MediaProvider::Mega,
        });
    }
    let media = st.remote.resolve(&url).await?;
    let source = media.source(st.remote.client().clone());
    let local_url = st.media_server.register_remote(source);
    Ok(ResolvedMediaInfo {
        url: local_url,
        name: media.name,
        size: media.size,
        kind: media.kind,
        provider: media.provider,
    })
}

#[tauri::command]
pub fn validate_media(state: State<'_, AppState>, url: String) -> AppResult<String> {
    let st = st(&state);
    crate::media::validate_media_url(&st.cfg, &url).map(|url| url.to_string())
}

#[tauri::command]
pub async fn get_cached_media_url(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<Option<String>> {
    let st = st(&state);
    crate::media_cache::cached_url(&st, &url)
}

#[tauri::command]
pub async fn cache_media(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    request_id: Option<String>,
) -> AppResult<String> {
    let st = st(&state);
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result =
        crate::media_cache::cache_media(&app, &st, &url, request_id.clone(), token.as_ref()).await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    result
}

#[tauri::command]
pub async fn clear_media_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let st = st(&state);
    crate::media_cache::clear(&st).await
}

#[tauri::command]
pub fn can_transcode() -> bool {
    crate::transcode::ffmpeg_path().is_some()
}

#[tauri::command]
pub async fn transcode_media(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    request_id: Option<String>,
) -> AppResult<String> {
    let st = st(&state);
    let token = request_id.as_deref().map(|id| st.register_cancel(id));
    let result =
        crate::transcode::transcode_media(&app, &st, &url, request_id.clone(), token.as_ref())
            .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    result
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDimensions {
    pub width: usize,
    pub height: usize,
}

#[tauri::command]
pub async fn get_image_dimensions(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<Option<MediaDimensions>> {
    let st = st(&state);
    let (url, extra_headers) = if crate::remote_media::needs_resolution(&url) {
        let media = st.remote.resolve(&url).await?;
        (media.url, media.headers)
    } else {
        (
            crate::media::validate_media_url(&st.cfg, &url)?.to_string(),
            Vec::new(),
        )
    };
    let mut request = st
        .http
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-524287")
        .header(reqwest::header::REFERER, "https://pawchive.pw/");
    for (name, value) in extra_headers {
        request = request.header(name, value);
    }
    let response = tokio::time::timeout(Duration::from_secs(12), request.send())
        .await
        .map_err(|_| AppError::Network("image dimensions request timed out".into()))?
        .map_err(|error| AppError::Network(crate::security::network_error_message(&error)))?;
    if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
    {
        return Ok(None);
    }
    const MAX_HEADER_BYTES: usize = 512 * 1024;
    let mut bytes = Vec::with_capacity(MAX_HEADER_BYTES);
    let mut response = response;
    while bytes.len() < MAX_HEADER_BYTES {
        let chunk = tokio::time::timeout(Duration::from_secs(12), response.chunk())
            .await
            .map_err(|_| AppError::Timeout)?
            .map_err(|error| AppError::Network(crate::security::network_error_message(&error)))?;
        let Some(chunk) = chunk else {
            break;
        };
        let remaining = MAX_HEADER_BYTES.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    let Ok(size) = imagesize::blob_size(&bytes) else {
        return Ok(None);
    };
    Ok(Some(MediaDimensions {
        width: size.width,
        height: size.height,
    }))
}

#[tauri::command]
pub async fn get_media_size(state: State<'_, AppState>, url: String) -> AppResult<Option<u64>> {
    let st = st(&state);
    if crate::mega::is_media_url(&url) {
        return Ok(st.mega.resolve(&url).await.ok().map(|file| file.size));
    }
    if crate::remote_media::needs_resolution(&url) {
        return Ok(st.remote.resolve(&url).await.ok().map(|media| media.size));
    }
    let url = crate::media::validate_media_url(&st.cfg, &url)?;
    if let Ok(Ok(response)) = tokio::time::timeout(
        Duration::from_secs(12),
        st.http
            .head(url.clone())
            .header(reqwest::header::REFERER, "https://pawchive.pw/")
            .send(),
    )
    .await
    {
        if response.status().is_success() {
            if let Some(length) = response.content_length() {
                return Ok(Some(length));
            }
        }
    }

    let response = tokio::time::timeout(
        Duration::from_secs(12),
        st.http
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .header(reqwest::header::REFERER, "https://pawchive.pw/")
            .send(),
    )
    .await
    .map_err(|_| AppError::Network("media size request timed out".into()))?
    .map_err(|error| AppError::Network(crate::security::network_error_message(&error)))?;
    if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
    {
        return Ok(None);
    }
    let total = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok());
    Ok(total.or_else(|| response.content_length()))
}

#[tauri::command]
pub fn local_media_url(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let st = st(&state);
    let root = st
        .download_dir()
        .canonicalize()
        .map_err(|error| AppError::Io(format!("could not read download folder: {error}")))?;
    let file = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|error| AppError::Io(format!("could not read media file: {error}")))?;
    if !file.starts_with(&root) {
        return Err(AppError::UnsafeUrl(
            "local media must be inside the download folder".into(),
        ));
    }
    if !file.is_file() {
        return Err(AppError::NotFound);
    }
    Ok(st.media_server.url_for(&file))
}

#[tauri::command]
pub async fn read_subtitle(path: String) -> AppResult<String> {
    blocking(move || crate::media::read_subtitle(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::config::{NetworkSettings, PawchiveConfig};
    use crate::db::Db;
    use crate::models::Post;
    use std::sync::{Arc, Mutex, RwLock};

    fn test_state(settings: AppSettings) -> AppState {
        let cfg = PawchiveConfig::default();
        let api = ApiClient::new(cfg.clone(), NetworkSettings::default()).unwrap();
        AppState {
            db: Arc::new(Db::open_in_memory().unwrap()),
            api,
            cfg,
            settings: Arc::new(RwLock::new(settings)),
            cancellations: Arc::new(Mutex::new(Default::default())),
            downloads: Arc::new(Mutex::new(Default::default())),
            download_gate: Arc::new(tokio::sync::Semaphore::new(1)),
            http: reqwest::Client::new(),
            mega: crate::mega::MegaResolver::new(reqwest::Client::new()),
            remote: std::sync::Arc::new(crate::remote_media::RemoteResolver::new(
                reqwest::Client::new(),
            )),
            app_data_dir: std::env::temp_dir(),
            default_download_dir: std::env::temp_dir(),
            media_server: crate::local_media::LocalMediaServer::test_instance(),
            account: Arc::new(RwLock::new(None)),
        }
    }

    #[test]
    fn extracts_the_session_cookie_from_a_cookie_header() {
        assert_eq!(
            session_cookie("__ddg1=abc; session=flask.session.value; other=1").as_deref(),
            Some("flask.session.value")
        );
        assert_eq!(session_cookie("other=1"), None);
        assert_eq!(session_cookie("session="), None);
    }

    #[test]
    fn compares_release_versions() {
        assert!(is_newer_version("1.0.1", "1.0.2").unwrap());
        assert!(is_newer_version("1.0.1", "v1.0.2").unwrap());
        assert!(!is_newer_version("1.0.2", "1.0.2").unwrap());
        assert!(!is_newer_version("1.0.2", "1.0.1").unwrap());
        assert!(is_newer_version("1.0.2", "not-a-version").is_err());
    }

    #[test]
    fn compares_four_part_release_versions() {
        assert!(is_newer_version("1.0.3", "1.0.3.1").unwrap());
        assert!(is_newer_version("1.0.3.1", "v1.0.4").unwrap());
        assert!(!is_newer_version("1.0.3.1", "v1.0.3.1").unwrap());
        assert!(!is_newer_version("1.0.4", "v1.0.3.1").unwrap());
        assert!(!is_newer_version("1.0.3.1", "1.0.3").unwrap());
    }

    #[test]
    fn keeps_visible_posts_in_the_page() {
        let state = test_state(AppSettings::default());
        let post = Post {
            id: "1".into(),
            user: "2".into(),
            service: "patreon".into(),
            title: "A normal post".into(),
            ..Default::default()
        };
        let page = build_post_page(&state, vec![post], 0).unwrap();
        assert_eq!(page.items.len(), 1);
    }

    #[test]
    fn hides_filtered_posts_in_the_page() {
        let state = test_state(AppSettings {
            hidden_keywords: vec!["spoiler".into()],
            ..Default::default()
        });
        let post = Post {
            id: "1".into(),
            user: "2".into(),
            service: "patreon".into(),
            title: "A spoiler post".into(),
            ..Default::default()
        };
        let page = build_post_page(&state, vec![post], 0).unwrap();
        assert!(page.items.is_empty());
    }
}
