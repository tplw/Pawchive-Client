use crate::error::{AppError, AppResult};
use crate::models::{now_ts, Attachment, DownloadRecord, DownloadRequest, MediaKind, Post};
use crate::security::safe_filename;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

/// Start a single media download and return the queued record immediately.
pub async fn enqueue(
    state: &AppState,
    app: &AppHandle,
    request: DownloadRequest,
) -> AppResult<DownloadRecord> {
    let url = crate::media::validate_media_url(&state.cfg, &request.url)?;
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
    let file_name = unique_name(&dir, &safe_filename(&proposed));
    let file_path = dir.join(&file_name);
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
    state.db.insert_download(&record)?;

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

async fn run(
    state: AppState,
    app: AppHandle,
    mut record: DownloadRecord,
    token: CancellationToken,
) {
    let _permit = match state.download_gate.acquire().await {
        Ok(permit) => permit,
        Err(_) => {
            finish_error(&state, &app, &record, "download queue is closed");
            return;
        }
    };

    // Space queued downloads out; the file host rate-limits bursts.
    tokio::time::sleep(Duration::from_millis(350)).await;
    let result = download_file(&state, &app, &mut record, &token).await;
    if let Ok(mut map) = state.downloads.lock() {
        map.remove(&record.id);
    }
    match result {
        Ok(()) => {
            let _ = state.db.update_download(
                &record.id,
                record.downloaded_bytes,
                record.total_bytes,
                "completed",
                None,
            );
            if let Ok(Some(updated)) = state.db.get_download(&record.id) {
                record = updated;
            }
            let _ = app.emit("download://complete", record);
        }
        Err(AppError::Cancelled) => {
            let _ = tokio::fs::remove_file(&record.file_path).await;
            let _ = state
                .db
                .update_download(&record.id, 0, record.total_bytes, "cancelled", None);
            if let Ok(Some(updated)) = state.db.get_download(&record.id) {
                record = updated;
            }
            let _ = app.emit("download://progress", record);
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&record.file_path).await;
            finish_error(&state, &app, &record, &error.to_string());
        }
    }
}

async fn download_file(
    state: &AppState,
    app: &AppHandle,
    record: &mut DownloadRecord,
    token: &CancellationToken,
) -> AppResult<()> {
    let response = fetch_with_retry(state, record, token).await?;
    record.total_bytes = response.content_length().map(|v| v as i64);
    state
        .db
        .update_download(&record.id, 0, record.total_bytes, "downloading", None)?;
    let mut file = tokio::fs::File::create(&record.file_path)
        .await
        .map_err(|e| AppError::Io(format!("could not create file: {e}")))?;
    let mut last_emit = Instant::now();
    let mut response = response;
    loop {
        let chunk = tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            chunk = response.chunk() => chunk.map_err(|e| AppError::Network(e.to_string()))?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Io(format!("could not write file: {e}")))?;
        record.downloaded_bytes += chunk.len() as i64;
        if last_emit.elapsed() >= Duration::from_millis(220) {
            last_emit = Instant::now();
            let _ = state.db.update_download(
                &record.id,
                record.downloaded_bytes,
                record.total_bytes,
                "downloading",
                None,
            );
            let _ = app.emit("download://progress", record.clone());
        }
    }
    file.flush()
        .await
        .map_err(|e| AppError::Io(format!("could not flush file: {e}")))?;
    Ok(())
}

async fn fetch_with_retry(
    state: &AppState,
    record: &DownloadRecord,
    token: &CancellationToken,
) -> AppResult<reqwest::Response> {
    let mut attempt = 0u32;
    loop {
        // DDoS Guard on the file host rate-limits bursts. Space requests out and
        // retry 429/5xx responses instead of surfacing a failed download.
        if attempt > 0 {
            let wait = Duration::from_secs(2u64.pow(attempt.min(4)));
            tokio::select! {
                _ = token.cancelled() => return Err(AppError::Cancelled),
                _ = tokio::time::sleep(wait) => {}
            }
        }
        let response = tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            response = state
                .http
                .get(&record.url)
                .header(reqwest::header::REFERER, "https://pawchive.pw/")
                .header(reqwest::header::ACCEPT, "*/*")
                .send() => response.map_err(|e| AppError::Network(e.to_string()))?,
        };
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            if attempt >= 5 {
                return Err(AppError::Unavailable(format!(
                    "file host is rate limiting downloads (HTTP {}); try again shortly",
                    status.as_u16()
                )));
            }
            tracing::warn!(
                attempt,
                status = status.as_u16(),
                "file host rate limited a download; retrying"
            );
            attempt += 1;
            continue;
        }
        return Err(AppError::Unavailable(format!(
            "file host answered HTTP {}",
            status.as_u16()
        )));
    }
}

fn finish_error(state: &AppState, app: &AppHandle, record: &DownloadRecord, message: &str) {
    let _ = state
        .db
        .update_download(&record.id, 0, record.total_bytes, "failed", Some(message));
    if let Ok(Some(updated)) = state.db.get_download(&record.id) {
        let _ = app.emit("download://error", updated);
    }
}

pub async fn cancel(state: &AppState, id: &str) -> AppResult<()> {
    if let Ok(mut map) = state.downloads.lock() {
        if let Some(token) = map.remove(id) {
            token.cancel();
        }
    }
    if let Some(record) = state.db.get_download(id)? {
        let path = PathBuf::from(&record.file_path);
        if path.exists() {
            let _ = tokio::fs::remove_file(path).await;
        }
        state
            .db
            .update_download(id, 0, record.total_bytes, "cancelled", None)?;
    }
    Ok(())
}

pub async fn delete(state: &AppState, id: &str) -> AppResult<()> {
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
    let records = state.db.clear_all_downloads()?;
    for record in &records {
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
    }
    Ok(records.len() as u64)
}

async fn remove_if_inside(root: &Path, path: &Path) {
    let Ok(root) = root.canonicalize() else {
        return;
    };
    let Ok(path) = path.canonicalize() else {
        return;
    };
    if path.starts_with(&root) {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub async fn download_post(
    state: &AppState,
    app: &AppHandle,
    service: &str,
    creator_id: &str,
    post_id: &str,
) -> AppResult<u64> {
    let post = state.api.post(service, creator_id, post_id, None).await?;
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
    let files = post_files(&state.cfg, &post);
    let count = files.len() as u64;
    let post_thumbnail = files
        .iter()
        .find_map(|(attachment, _)| attachment.thumbnail_url.clone());
    for (attachment, kind) in files {
        let request = DownloadRequest {
            url: attachment.url.clone(),
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
    let count = items.len() as u64;
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
        }
    }
    Ok(count)
}

fn post_files(cfg: &crate::config::PawchiveConfig, post: &Post) -> Vec<(Attachment, MediaKind)> {
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

fn unique_name(dir: &Path, name: &str) -> String {
    let candidate = if name.trim().is_empty() {
        "media".to_string()
    } else {
        name.to_string()
    };
    let path = dir.join(&candidate);
    if !path.exists() {
        return candidate;
    }
    let (stem, ext) = split_name(&candidate);
    for index in 1..10_000 {
        let next = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        if !dir.join(&next).exists() {
            return next;
        }
    }
    format!("{stem}-{}.{}", uuid::Uuid::new_v4(), ext)
}

fn split_name(name: &str) -> (String, String) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            (stem.to_string(), ext.to_string())
        }
        _ => (name.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiClient;
    use crate::config::{NetworkSettings, PawchiveConfig};
    use crate::db::Db;
    use crate::state::AppState;
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
            app_data_dir: std::env::temp_dir(),
            default_download_dir: std::env::temp_dir(),
            media_server: crate::local_media::LocalMediaServer::test_instance(),
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

    #[test]
    fn unique_names_do_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clip.mp4"), b"x").unwrap();
        assert_eq!(unique_name(dir.path(), "clip.mp4"), "clip-1.mp4");
    }

    #[test]
    fn split_names_handles_extensions() {
        assert_eq!(split_name("clip.mp4"), ("clip".into(), "mp4".into()));
        assert_eq!(split_name("clip"), ("clip".into(), String::new()));
    }
}
