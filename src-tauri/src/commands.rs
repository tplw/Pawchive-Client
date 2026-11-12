use crate::app::state::AppState;
use crate::features::account::service::AccountService;
use crate::features::creators::service::CreatorService;
use crate::features::downloads::service::DownloadService;
use crate::features::library::service::LibraryService;
use crate::features::media::service::{MediaDimensions, MediaService, ResolvedMediaInfo};
use crate::features::posts::service::PostService;
use crate::features::search::service::SearchService;
use crate::features::settings::service::SettingsService;
use crate::features::updates::service::{UpdateInfo, UpdateService};
use crate::shared::config::PawchiveConfig;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{
    AccountState, Announcement, AppSettings, Comment, CreatorPage, CreatorProfile, CreatorSummary,
    DownloadRecord, DownloadRequest, PlaybackProgress, Playlist, PlaylistItem, PostDetail,
    PostPage, PostSummary, Revision, SearchPage,
};
use crate::shared::task::blocking;
use tauri::{AppHandle, State};

fn st(state: &State<'_, AppState>) -> AppState {
    state.inner().clone()
}

/* ------------------------------- settings ------------------------------- */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    Ok(SettingsService::new(st(&state)).current())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    SettingsService::new(st(&state)).save(settings).await
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> PawchiveConfig {
    tracing::debug!("frontend requested configuration");
    state.cfg.clone()
}

#[tauri::command]
pub async fn check_for_update(state: State<'_, AppState>) -> AppResult<UpdateInfo> {
    UpdateService::new(st(&state)).check().await
}

#[tauri::command]
pub fn open_external(url: String) -> AppResult<()> {
    let url = crate::shared::security::validate_external_url(&url)?;
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
    CreatorService::new(st(&state))
        .sync(&app, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_creator_count(state: State<'_, AppState>) -> AppResult<i64> {
    CreatorService::new(st(&state)).count().await
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
    CreatorService::new(st(&state))
        .list(query.unwrap_or_default(), service, sort, offset, limit)
        .await
}

#[tauri::command]
pub async fn get_creator(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
) -> AppResult<Option<CreatorSummary>> {
    CreatorService::new(st(&state))
        .get(&service, &creator_id)
        .await
}

#[tauri::command]
pub async fn get_creator_profile(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<CreatorProfile> {
    CreatorService::new(st(&state))
        .profile(&service, &creator_id, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_creator_links(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<CreatorProfile>> {
    CreatorService::new(st(&state))
        .links(&service, &creator_id, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_creator_announcements(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Announcement>> {
    CreatorService::new(st(&state))
        .announcements(&service, &creator_id, request_id.as_deref())
        .await
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
    let query = query.filter(|value| !value.trim().is_empty());
    PostService::new(st(&state))
        .creator_posts(
            &service,
            &creator_id,
            offset.unwrap_or(0),
            query.as_deref(),
            request_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn get_similar_creators(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<CreatorSummary>> {
    CreatorService::new(st(&state))
        .similar(&service, &creator_id, request_id.as_deref())
        .await
}

/* --------------------------------- posts -------------------------------- */

#[tauri::command]
pub async fn get_recent_posts(
    state: State<'_, AppState>,
    offset: Option<i64>,
    request_id: Option<String>,
) -> AppResult<PostPage> {
    PostService::new(st(&state))
        .recent(offset.unwrap_or(0), request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_post_summary(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
) -> AppResult<PostSummary> {
    PostService::new(st(&state))
        .summary(&service, &creator_id, &post_id)
        .await
}

#[tauri::command]
pub async fn get_post(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<PostDetail> {
    PostService::new(st(&state))
        .detail(&service, &creator_id, &post_id, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_post_comments(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Comment>> {
    PostService::new(st(&state))
        .comments(&service, &creator_id, &post_id, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_post_revisions(
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
    request_id: Option<String>,
) -> AppResult<Vec<Revision>> {
    PostService::new(st(&state))
        .revisions(&service, &creator_id, &post_id, request_id.as_deref())
        .await
}

#[tauri::command]
pub async fn get_popular_posts(
    state: State<'_, AppState>,
    offset: Option<i64>,
    request_id: Option<String>,
) -> AppResult<PostPage> {
    PostService::new(st(&state))
        .popular(offset.unwrap_or(0), request_id.as_deref())
        .await
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
    SearchService::new(st(&state))
        .search(
            query,
            offset.unwrap_or(0),
            service,
            media,
            sort,
            request_id.as_deref(),
        )
        .await
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, request_id: String) -> bool {
    state.cancel_request(&request_id)
}

/* ------------------------------ favorites ------------------------------ */

#[tauri::command]
pub async fn list_favorite_creators(state: State<'_, AppState>) -> AppResult<Vec<CreatorSummary>> {
    LibraryService::new(st(&state)).favorite_creators().await
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
    LibraryService::new(st(&state))
        .set_favorite_creator(service, creator_id, name, public_id, favorited)
        .await
}

/* ------------------------------- playlists ------------------------------ */

#[tauri::command]
pub async fn list_playlists(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    LibraryService::new(st(&state)).list_playlists().await
}

#[tauri::command]
pub async fn get_playlist(state: State<'_, AppState>, id: i64) -> AppResult<Playlist> {
    LibraryService::new(st(&state)).get_playlist(id).await
}

#[tauri::command]
pub async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> AppResult<Playlist> {
    LibraryService::new(st(&state))
        .create_playlist(name, description)
        .await
}

#[tauri::command]
pub async fn rename_playlist(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<()> {
    LibraryService::new(st(&state))
        .rename_playlist(id, name, description)
        .await
}

#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    LibraryService::new(st(&state)).delete_playlist(id).await
}

#[tauri::command]
pub async fn list_playlist_items(
    state: State<'_, AppState>,
    playlist_id: i64,
) -> AppResult<Vec<PlaylistItem>> {
    LibraryService::new(st(&state))
        .list_playlist_items(playlist_id)
        .await
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
    LibraryService::new(st(&state))
        .add_playlist_item(
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
        )
        .await
}

#[tauri::command]
pub async fn remove_playlist_item(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    LibraryService::new(st(&state))
        .remove_playlist_item(id)
        .await
}

/* ------------------------------- downloads ------------------------------ */

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> AppResult<DownloadRecord> {
    DownloadService::new(st(&state)).start(&app, request).await
}

#[tauri::command]
pub async fn download_post(
    app: AppHandle,
    state: State<'_, AppState>,
    service: String,
    creator_id: String,
    post_id: String,
) -> AppResult<u64> {
    DownloadService::new(st(&state))
        .download_post(&app, &service, &creator_id, &post_id)
        .await
}

#[tauri::command]
pub async fn download_playlist(
    app: AppHandle,
    state: State<'_, AppState>,
    playlist_id: i64,
) -> AppResult<u64> {
    DownloadService::new(st(&state))
        .download_playlist(&app, playlist_id)
        .await
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> AppResult<()> {
    DownloadService::new(st(&state)).cancel(&id).await
}

#[tauri::command]
pub async fn delete_download(state: State<'_, AppState>, id: String) -> AppResult<()> {
    DownloadService::new(st(&state)).delete(&id).await
}

#[tauri::command]
pub async fn retry_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<DownloadRecord> {
    DownloadService::new(st(&state)).retry(&app, &id).await
}

#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> AppResult<u64> {
    DownloadService::new(st(&state)).clear_completed().await
}

#[tauri::command]
pub async fn clear_all_downloads(state: State<'_, AppState>) -> AppResult<u64> {
    DownloadService::new(st(&state)).clear_all().await
}

#[tauri::command]
pub async fn list_downloads(state: State<'_, AppState>) -> AppResult<Vec<DownloadRecord>> {
    DownloadService::new(st(&state)).list().await
}

#[tauri::command]
pub fn open_downloads_folder(state: State<'_, AppState>) -> AppResult<()> {
    DownloadService::new(st(&state)).open_folder()
}

/* -------------------------------- account ------------------------------- */

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
    remember: Option<bool>,
) -> AppResult<AccountState> {
    AccountService::new(st(&state))
        .login(username, password, remember)
        .await
}

#[tauri::command]
pub fn get_account_state(state: State<'_, AppState>) -> AccountState {
    AccountService::new(st(&state)).state()
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> AppResult<AccountState> {
    AccountService::new(st(&state)).logout()
}

#[tauri::command]
pub async fn sync_account_favorites(state: State<'_, AppState>) -> AppResult<u64> {
    AccountService::new(st(&state)).sync_favorites().await
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

#[tauri::command]
pub async fn resolve_media(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<ResolvedMediaInfo> {
    MediaService::new(st(&state)).resolve(&url).await
}

#[tauri::command]
pub async fn set_provider_password(
    state: State<'_, AppState>,
    url: String,
    password: String,
    remember: bool,
) -> AppResult<()> {
    let st = st(&state);
    let key = crate::infra::providers::password_key(&url)
        .ok_or_else(|| AppError::Validation("this link does not use a provider password".into()))?;
    blocking(move || st.passwords.set(&key, &password, remember)).await
}

#[tauri::command]
pub async fn forget_provider_password(state: State<'_, AppState>, url: String) -> AppResult<()> {
    let st = st(&state);
    let key = crate::infra::providers::password_key(&url)
        .ok_or_else(|| AppError::Validation("this link does not use a provider password".into()))?;
    blocking(move || {
        st.passwords.remove(&key);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn unlock_provider_link(state: State<'_, AppState>, url: String) -> AppResult<()> {
    let st = st(&state);
    if crate::infra::providers::proton::is_proton_url(&url) {
        return st.proton.unlock(&url).await;
    }
    if crate::infra::providers::mega::password_key(&url).is_some() {
        return st.mega.unlock(&url).await;
    }
    Ok(())
}

#[tauri::command]
pub fn validate_media(state: State<'_, AppState>, url: String) -> AppResult<String> {
    let st = st(&state);
    crate::infra::media::validate_media_url(&st.cfg, &url).map(|url| url.to_string())
}

#[tauri::command]
pub async fn get_cached_media_url(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<Option<String>> {
    let st = st(&state);
    crate::infra::media_cache::cached_url(&st, &url)
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
        crate::infra::media_cache::cache_media(&app, &st, &url, request_id.clone(), token.as_ref())
            .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    result
}

#[tauri::command]
pub async fn clear_media_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let st = st(&state);
    crate::infra::media_cache::clear(&st).await
}

#[tauri::command]
pub fn can_transcode() -> bool {
    crate::infra::transcode::ffmpeg_path().is_some()
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
    let result = crate::infra::transcode::transcode_media(
        &app,
        &st,
        &url,
        request_id.clone(),
        token.as_ref(),
    )
    .await;
    if let Some(id) = request_id.as_deref() {
        st.finish_cancel(id);
    }
    result
}

#[tauri::command]
pub async fn get_image_dimensions(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<Option<MediaDimensions>> {
    MediaService::new(st(&state)).image_dimensions(&url).await
}

#[tauri::command]
pub async fn get_media_size(state: State<'_, AppState>, url: String) -> AppResult<Option<u64>> {
    MediaService::new(st(&state)).size(&url).await
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
    blocking(move || crate::infra::media::read_subtitle(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::posts::summary::build_post_page;
    use crate::infra::pawchive_api::ApiClient;
    use crate::infra::sqlite::Db;
    use crate::shared::config::{NetworkSettings, PawchiveConfig};
    use crate::shared::models::Post;
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
            mega: crate::infra::providers::mega::MegaResolver::new(reqwest::Client::new()),
            proton: Arc::new(crate::infra::providers::proton::ProtonResolver::new()),
            passwords: Arc::new(crate::infra::provider_passwords::ProviderPasswords::in_memory()),
            remote: std::sync::Arc::new(crate::infra::providers::remote::RemoteResolver::new(
                reqwest::Client::new(),
            )),
            app_data_dir: std::env::temp_dir(),
            default_download_dir: std::env::temp_dir(),
            media_server: crate::infra::local_http::LocalMediaServer::test_instance(),
            account: Arc::new(RwLock::new(None)),
        }
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
