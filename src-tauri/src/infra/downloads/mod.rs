mod paths;
mod worker;

use paths::{remove_if_inside, reserve_unique_path};
use worker::{cancel_active, run};

use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};
#[cfg(test)]
use crate::shared::models::Post;
use crate::shared::models::{now_ts, Attachment, DownloadRecord, DownloadRequest, MediaKind};
use crate::shared::security::safe_filename;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

/// Start a single media download and return the queued record immediately.
pub async fn enqueue(
    state: &AppState,
    app: &AppHandle,
    mut request: DownloadRequest,
) -> AppResult<DownloadRecord> {
    if !request.service.trim().is_empty()
        && !request.creator_id.trim().is_empty()
        && crate::features::posts::filters::is_creator_blocked(
            &request.service,
            &request.creator_id,
            &state.settings(),
        )
    {
        return Err(AppError::Blocked);
    }
    let url = crate::infra::media::validate_media_url(&state.cfg, &request.url)?;
    // MEGA filenames only exist in the encrypted attributes. Resolve them
    // before reserving the destination so the saved file has its real name
    // and extension instead of the node handle.
    let mega_file = if crate::infra::providers::mega::is_media_url(url.as_str()) {
        Some(state.mega.resolve(url.as_str()).await?)
    } else {
        None
    };
    if let Some(file) = &mega_file {
        // The archive/playlist only sees the node handle, so always use the
        // real filename and media kind from the encrypted attributes.
        request.file_name = file.name.clone();
        request.media_kind = file.kind().as_str().to_string();
    }
    if !crate::infra::providers::mega::is_media_url(url.as_str())
        && crate::infra::providers::remote::needs_resolution(url.as_str())
    {
        let media = state.remote.resolve(url.as_str()).await?;
        request.file_name = media.name.clone();
        request.media_kind = media.kind.as_str().to_string();
    }
    let dir = state.download_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Io(format!("could not create download folder: {e}")))?;

    let proposed = if request.file_name.trim().is_empty() {
        url.path_segments()
            .and_then(|mut s| s.next_back())
            .unwrap_or("media")
            .to_string()
    } else {
        request.file_name.clone()
    };
    let file_name = safe_filename(&proposed);
    let (file_name, file_path) = reserve_unique_path(&dir, &file_name).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ts();
    let record = DownloadRecord {
        id: id.clone(),
        url: url.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        file_name,
        media_kind: request.media_kind,
        title: request.title,
        creator_name: request.creator_name,
        service: request.service,
        creator_id: request.creator_id,
        post_id: request.post_id,
        playlist_id: request.playlist_id,
        thumbnail_url: request.thumbnail_url,
        total_bytes: None,
        downloaded_bytes: 0,
        status: "queued".into(),
        error: None,
        created_at: now,
        updated_at: now,
    };
    if let Err(error) = state.db.insert_download(&record) {
        let _ = tokio::fs::remove_file(&file_path).await;
        return Err(error);
    }

    let token = CancellationToken::new();
    if let Ok(mut map) = state.downloads.lock() {
        map.insert(id.clone(), token.clone());
    }
    let task_state = state.clone();
    let task_app = app.clone();
    let task_record = record.clone();
    tauri::async_runtime::spawn(async move {
        run(task_state, task_app, task_record, token).await;
    });
    Ok(record)
}

/// Requeue a failed or cancelled download. The record keeps its id so the
/// Downloads list can update in place instead of showing a duplicate.
pub async fn retry(state: &AppState, app: &AppHandle, id: &str) -> AppResult<DownloadRecord> {
    let mut record = state.db.get_download(id)?.ok_or(AppError::NotFound)?;
    if record.status == "queued" || record.status == "downloading" {
        return Ok(record);
    }
    if record.status != "failed" && record.status != "cancelled" {
        return Err(AppError::Validation(
            "only failed or cancelled downloads can be retried".into(),
        ));
    }
    let url = crate::infra::media::validate_media_url(&state.cfg, &record.url)?;
    let dir = state.download_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Io(format!("could not create download folder: {e}")))?;
    // A failed attempt may have left a partial file behind. Remove it before
    // reusing the name, and fall back to a suffixed name if it cannot be
    // deleted (for example because another process still holds it).
    remove_if_inside(&dir, Path::new(&record.file_path)).await;
    let (file_name, file_path) =
        reserve_unique_path(&dir, &safe_filename(&record.file_name)).await?;

    record.url = url.to_string();
    record.file_name = file_name;
    record.file_path = file_path.to_string_lossy().to_string();
    record.total_bytes = None;
    record.downloaded_bytes = 0;
    record.status = "queued".into();
    record.error = None;
    record.updated_at = now_ts();
    if let Err(error) = state.db.reset_download(&record) {
        let _ = tokio::fs::remove_file(&file_path).await;
        return Err(error);
    }

    let token = CancellationToken::new();
    if let Ok(mut map) = state.downloads.lock() {
        map.insert(record.id.clone(), token.clone());
    }
    let task_state = state.clone();
    let task_app = app.clone();
    let task_record = record.clone();
    tauri::async_runtime::spawn(async move {
        run(task_state, task_app, task_record, token).await;
    });
    Ok(record)
}

pub async fn cancel(state: &AppState, id: &str) -> AppResult<()> {
    cancel_active(state, id).await;
    if let Some(record) = state.db.get_download(id)? {
        if record.status != "queued" && record.status != "downloading" {
            return Ok(());
        }
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
        state
            .db
            .update_download(id, 0, record.total_bytes, "cancelled", None)?;
    }
    Ok(())
}

pub async fn delete(state: &AppState, id: &str) -> AppResult<()> {
    cancel_active(state, id).await;
    if let Some(record) = state.db.get_download(id)? {
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
        state.db.delete_download(id)?;
    }
    Ok(())
}

pub async fn clear_completed(state: &AppState) -> AppResult<u64> {
    let records = state.db.clear_completed_downloads()?;
    for record in &records {
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
    }
    Ok(records.len() as u64)
}

pub async fn clear_all(state: &AppState) -> AppResult<u64> {
    // Cancel active transfers first so they cannot recreate files after the
    // cleanup below. Wait briefly for the workers to observe the tokens.
    let ids: Vec<String> = match state.downloads.lock() {
        Ok(map) => map
            .iter()
            .map(|(id, token)| {
                token.cancel();
                id.clone()
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    for _ in 0..20 {
        let active = state
            .downloads
            .lock()
            .map(|map| map.keys().any(|id| ids.contains(id)))
            .unwrap_or(false);
        if !active {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let records = state.db.clear_all_downloads()?;
    for record in &records {
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
    }
    Ok(records.len() as u64)
}

pub async fn download_post(
    state: &AppState,
    app: &AppHandle,
    service: &str,
    creator_id: &str,
    post_id: &str,
) -> AppResult<u64> {
    let post = state.api.post(service, creator_id, post_id, None).await?;
    if crate::features::posts::filters::is_creator_blocked(
        &post.service,
        &post.user,
        &state.settings(),
    ) {
        return Err(AppError::Blocked);
    }
    let creator_name = state
        .db
        .get_creator(service, creator_id)?
        .map(|c| c.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| creator_id.to_string());
    let title = if post.title.trim().is_empty() {
        "Untitled post".to_string()
    } else {
        post.title.clone()
    };
    let attachments: Vec<Attachment> = post
        .all_files_including_direct()
        .into_iter()
        .filter_map(|file| Attachment::new(&state.cfg, &file))
        .collect();
    // A post may link a Drive or MEGA folder instead of individual files.
    // Expand it before queueing so every contained file is downloaded.
    let attachments =
        crate::infra::providers::remote::expand_folders(&state.mega, &state.remote, attachments)
            .await;
    let files: Vec<(Attachment, MediaKind)> = attachments
        .into_iter()
        .filter(|attachment| !attachment.preview_only)
        .map(|attachment| {
            let kind = attachment.kind;
            (attachment, kind)
        })
        .collect();
    let mut count = 0u64;
    let post_thumbnail = files
        .iter()
        .find_map(|(attachment, _)| attachment.thumbnail_url.clone());
    for (attachment, kind) in files {
        let request = DownloadRequest {
            url: attachment.download_url.clone(),
            file_name: attachment.name.clone(),
            title: title.clone(),
            creator_name: creator_name.clone(),
            service: post.service.clone(),
            creator_id: post.user.clone(),
            post_id: post.id.clone(),
            playlist_id: None,
            thumbnail_url: attachment
                .thumbnail_url
                .clone()
                .or_else(|| post_thumbnail.clone()),
            media_kind: kind.as_str().to_string(),
        };
        if let Err(error) = enqueue(state, app, request).await {
            tracing::warn!(%error, "could not queue post attachment");
        } else {
            count += 1;
        }
    }
    Ok(count)
}

pub async fn download_playlist(
    state: &AppState,
    app: &AppHandle,
    playlist_id: i64,
) -> AppResult<u64> {
    let items = state.db.list_playlist_items(playlist_id)?;
    let mut count = 0u64;
    for item in items {
        let request = DownloadRequest {
            url: item.media_url,
            file_name: item
                .media_path
                .rsplit('/')
                .next()
                .unwrap_or("media")
                .to_string(),
            title: item.title,
            creator_name: item.creator_name,
            service: item.service,
            creator_id: item.creator_id,
            post_id: item.post_id,
            playlist_id: Some(playlist_id),
            thumbnail_url: item.thumbnail_url,
            media_kind: item.media_kind,
        };
        if let Err(error) = enqueue(state, app, request).await {
            tracing::warn!(%error, "could not queue playlist item");
        } else {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
fn post_files(
    cfg: &crate::shared::config::PawchiveConfig,
    post: &Post,
) -> Vec<(Attachment, MediaKind)> {
    post.all_files_including_direct()
        .into_iter()
        .filter_map(|file| Attachment::new(cfg, &file))
        // Preview-only files are rendered by the archive's image host and do
        // not exist on the file host. Queueing them only produces 404 failures.
        .filter(|attachment| !attachment.preview_only)
        .map(|attachment| {
            let kind = attachment.kind;
            (attachment, kind)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::paths::split_name;
    use super::worker::fetch_with_retry;
    use super::*;
    use crate::app::state::AppState;
    use crate::infra::pawchive_api::ApiClient;
    use crate::infra::sqlite::Db;
    use crate::shared::config::{NetworkSettings, PawchiveConfig};
    use std::sync::{Arc, Mutex, RwLock};
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn retries_rate_limited_downloads() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(429))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"ok"))
            .mount(&server)
            .await;
        let cfg = PawchiveConfig::default();
        let state = AppState {
            db: Arc::new(Db::open_in_memory().unwrap()),
            api: ApiClient::new(cfg.clone(), NetworkSettings::default()).unwrap(),
            cfg,
            settings: Arc::new(RwLock::new(Default::default())),
            cancellations: Arc::new(Mutex::new(Default::default())),
            downloads: Arc::new(Mutex::new(Default::default())),
            download_gate: Arc::new(tokio::sync::Semaphore::new(1)),
            http: reqwest::Client::new(),
            mega: crate::infra::providers::mega::MegaResolver::new(reqwest::Client::new()),
            remote: std::sync::Arc::new(crate::infra::providers::remote::RemoteResolver::new(
                reqwest::Client::new(),
            )),
            app_data_dir: std::env::temp_dir(),
            default_download_dir: std::env::temp_dir(),
            media_server: crate::infra::local_http::LocalMediaServer::test_instance(),
            account: Arc::new(RwLock::new(None)),
        };
        let record = DownloadRecord {
            id: "test".into(),
            url: server.uri(),
            file_path: String::new(),
            file_name: String::new(),
            media_kind: String::new(),
            title: String::new(),
            creator_name: String::new(),
            service: String::new(),
            creator_id: String::new(),
            post_id: String::new(),
            playlist_id: None,
            thumbnail_url: None,
            total_bytes: None,
            downloaded_bytes: 0,
            status: "downloading".into(),
            error: None,
            created_at: 0,
            updated_at: 0,
        };
        let token = CancellationToken::new();
        let response = fetch_with_retry(&state, &record, &token).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
    }

    #[test]
    fn skips_preview_only_files() {
        let cfg = PawchiveConfig::default();
        let post: Post = serde_json::from_value(serde_json::json!({
            "id": "1",
            "user": "creator",
            "service": "patreon",
            "title": "Preview post",
            "file": {
                "name": "preview.png",
                "path": "/aa/bb/preview.png",
                "preview_only": true
            },
            "attachments": [{
                "name": "full.png",
                "path": "/cc/dd/full.png",
                "preview_only": false
            }]
        }))
        .unwrap();
        let files = post_files(&cfg, &post);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0.name, "full.png");
    }

    #[tokio::test]
    async fn reserved_names_do_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clip.mp4"), b"x").unwrap();
        let (name, path) = reserve_unique_path(dir.path(), "clip.mp4").await.unwrap();
        assert_eq!(name, "clip-1.mp4");
        assert!(path.exists());
        let (second, _) = reserve_unique_path(dir.path(), "clip.mp4").await.unwrap();
        assert_eq!(second, "clip-2.mp4");
    }

    #[test]
    fn split_names_handles_extensions() {
        assert_eq!(split_name("clip.mp4"), ("clip".into(), "mp4".into()));
        assert_eq!(split_name("clip"), ("clip".into(), String::new()));
    }
}
