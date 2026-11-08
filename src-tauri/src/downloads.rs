use crate::error::{AppError, AppResult};
#[cfg(test)]
use crate::models::Post;
use crate::models::{now_ts, Attachment, DownloadRecord, DownloadRequest, MediaKind};
use crate::security::safe_filename;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

/// Start a single media download and return the queued record immediately.
pub async fn enqueue(
    state: &AppState,
    app: &AppHandle,
    mut request: DownloadRequest,
) -> AppResult<DownloadRecord> {
    let url = crate::media::validate_media_url(&state.cfg, &request.url)?;
    // MEGA filenames only exist in the encrypted attributes. Resolve them
    // before reserving the destination so the saved file has its real name
    // and extension instead of the node handle.
    let mega_file = if crate::mega::is_media_url(url.as_str()) {
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
    if !crate::mega::is_media_url(url.as_str())
        && crate::remote_media::needs_resolution(url.as_str())
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
    let url = crate::media::validate_media_url(&state.cfg, &record.url)?;
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
    tokio::select! {
        _ = token.cancelled() => {
            if let Ok(mut map) = state.downloads.lock() {
                map.remove(&record.id);
            }
            return;
        }
        _ = tokio::time::sleep(Duration::from_millis(350)) => {}
    }
    let result = download_file(&state, &app, &mut record, &token).await;
    let record_id = record.id.clone();
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
            remove_active_file(&state, &record).await;
            let _ = state
                .db
                .update_download(&record.id, 0, record.total_bytes, "cancelled", None);
            if let Ok(Some(updated)) = state.db.get_download(&record.id) {
                record = updated;
            }
            let _ = app.emit("download://progress", record);
        }
        Err(error) => {
            remove_active_file(&state, &record).await;
            finish_error(&state, &app, &record, &error.to_string());
        }
    }
    // Remove the worker only after its final file/DB work. Callers such as
    // `delete` and `clear_all` wait for this map entry, so removing it earlier
    // would let them race the worker's own cleanup.
    if let Ok(mut map) = state.downloads.lock() {
        map.remove(&record_id);
    }
}

/// Only remove the partial file while the download record still exists. If the
/// user deleted the record, its filename may already have been reused.
async fn remove_active_file(state: &AppState, record: &DownloadRecord) {
    if state.db.get_download(&record.id).ok().flatten().is_some() {
        remove_if_inside(&state.download_dir(), Path::new(&record.file_path)).await;
    }
}

async fn download_file(
    state: &AppState,
    app: &AppHandle,
    record: &mut DownloadRecord,
    token: &CancellationToken,
) -> AppResult<()> {
    if crate::mega::is_media_url(&record.url) {
        return download_mega_file(state, app, record, token).await;
    }
    if crate::remote_media::needs_resolution(&record.url) {
        let media = state.remote.resolve(&record.url).await?;
        let request = media
            .apply_headers(state.http.get(&media.url))
            .header(reqwest::header::ACCEPT, "*/*")
            .header(reqwest::header::RANGE, "bytes=0-");
        let response = tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            response = tokio::time::timeout(Duration::from_secs(120), request.send()) => {
                match response {
                    Ok(response) => response.map_err(|error| {
                        AppError::Network(crate::security::network_error_message(&error))
                    })?,
                    Err(_) => return Err(AppError::Timeout),
                }
            }
        };
        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            return Err(AppError::Unavailable(format!(
                "{} answered HTTP {}",
                media.provider.as_str(),
                response.status().as_u16()
            )));
        }
        return save_download_response(
            state,
            app,
            record,
            response,
            Some(media.size as i64),
            token,
        )
        .await;
    }
    let response = fetch_with_retry(state, record, token).await?;
    save_download_response(state, app, record, response, None, token).await
}

async fn save_download_response(
    state: &AppState,
    app: &AppHandle,
    record: &mut DownloadRecord,
    response: reqwest::Response,
    known_total: Option<i64>,
    token: &CancellationToken,
) -> AppResult<()> {
    record.total_bytes = known_total.or_else(|| response.content_length().map(|v| v as i64));
    state
        .db
        .update_download(&record.id, 0, record.total_bytes, "downloading", None)?;
    let file = tokio::fs::File::create(&record.file_path)
        .await
        .map_err(|e| AppError::Io(format!("could not create file: {e}")))?;
    let mut file = BufWriter::with_capacity(1024 * 1024, file);
    let mut last_emit = Instant::now();
    let mut response = response;
    loop {
        let chunk = tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            chunk = tokio::time::timeout(CHUNK_TIMEOUT, response.chunk()) => {
                match chunk {
                    Ok(chunk) => chunk.map_err(|e| {
                        AppError::Network(crate::security::network_error_message(&e))
                    })?,
                    Err(_) => return Err(AppError::Timeout),
                }
            }
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

async fn download_mega_file(
    state: &AppState,
    app: &AppHandle,
    record: &mut DownloadRecord,
    token: &CancellationToken,
) -> AppResult<()> {
    let file = state.mega.resolve(&record.url).await?;
    record.total_bytes = Some(file.size as i64);
    state
        .db
        .update_download(&record.id, 0, record.total_bytes, "downloading", None)?;
    let path = PathBuf::from(&record.file_path);
    let url = record.url.clone();
    let mut last_emit = Instant::now();
    let (_, downloaded) = crate::mega::download_to_path(
        &state.mega,
        &url,
        &path,
        u64::MAX,
        Some(token),
        |downloaded, _total| {
            record.downloaded_bytes = downloaded as i64;
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
        },
    )
    .await?;
    record.downloaded_bytes = downloaded as i64;
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
            response = tokio::time::timeout(
                Duration::from_secs(120),
                state
                    .http
                    .get(&record.url)
                    .header(reqwest::header::REFERER, "https://pawchive.pw/")
                    .header(reqwest::header::ACCEPT, "*/*")
                    // Mirror a normal media player's streaming request. Some CDNs
                    // serve range requests from a faster/streaming path.
                    .header(reqwest::header::RANGE, "bytes=0-")
                    .send(),
            ) => match response {
                Ok(response) => response.map_err(|e| {
                    AppError::Network(crate::security::network_error_message(&e))
                })?,
                Err(_) => return Err(AppError::Timeout),
            },
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

/// Signal a running download to stop and give it a moment to release its file
/// handle before callers delete or replace the destination.
async fn cancel_active(state: &AppState, id: &str) {
    if let Ok(map) = state.downloads.lock() {
        if let Some(token) = map.get(id) {
            token.cancel();
        }
    }
    for _ in 0..40 {
        let active = state
            .downloads
            .lock()
            .map(|map| map.contains_key(id))
            .unwrap_or(false);
        if !active {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
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
    let attachments: Vec<Attachment> = post
        .all_files_including_direct()
        .into_iter()
        .filter_map(|file| Attachment::new(&state.cfg, &file))
        .collect();
    // A post may link a Drive or MEGA folder instead of individual files.
    // Expand it before queueing so every contained file is downloaded.
    let attachments =
        crate::remote_media::expand_folders(&state.mega, &state.remote, attachments).await;
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

/// Atomically reserve a destination filename by creating it with
/// `create_new`. Two concurrent queue operations can therefore never pick the
/// same name and truncate a completed download.
async fn reserve_unique_path(dir: &Path, name: &str) -> AppResult<(String, PathBuf)> {
    let candidate = if name.trim().is_empty() {
        "media".to_string()
    } else {
        name.to_string()
    };
    let (stem, ext) = split_name(&candidate);
    for index in 0..10_000 {
        let next = if index == 0 {
            candidate.clone()
        } else if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let path = dir.join(&next);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => {
                drop(file);
                return Ok((next, path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::Io(format!(
                    "could not reserve download file: {error}"
                )))
            }
        }
    }
    for _ in 0..10 {
        let next = if ext.is_empty() {
            format!("{stem}-{}", uuid::Uuid::new_v4())
        } else {
            format!("{stem}-{}.{ext}", uuid::Uuid::new_v4())
        };
        let path = dir.join(&next);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => {
                drop(file);
                return Ok((next, path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::Io(format!(
                    "could not reserve download file: {error}"
                )))
            }
        }
    }
    Err(AppError::Io(
        "could not find a unique filename for the download".into(),
    ))
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
            mega: crate::mega::MegaResolver::new(reqwest::Client::new()),
            remote: std::sync::Arc::new(crate::remote_media::RemoteResolver::new(
                reqwest::Client::new(),
            )),
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
