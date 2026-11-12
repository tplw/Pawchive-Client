use super::paths::remove_if_inside;
use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::DownloadRecord;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) async fn run(
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
    if crate::infra::providers::mega::is_media_url(&record.url) {
        return download_mega_file(state, app, record, token).await;
    }
    if crate::infra::providers::proton::is_proton_url(&record.url) {
        return download_proton_file(state, app, record, token).await;
    }
    if crate::infra::providers::remote::needs_resolution(&record.url) {
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
                        AppError::Network(crate::shared::security::network_error_message(&error))
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
                        AppError::Network(crate::shared::security::network_error_message(&e))
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
    let (_, downloaded) = crate::infra::providers::mega::download_to_path(
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

async fn download_proton_file(
    state: &AppState,
    app: &AppHandle,
    record: &mut DownloadRecord,
    token: &CancellationToken,
) -> AppResult<()> {
    let file = state.proton.resolve(&record.url).await?;
    record.total_bytes = Some(file.size as i64);
    state
        .db
        .update_download(&record.id, 0, record.total_bytes, "downloading", None)?;
    let path = PathBuf::from(&record.file_path);
    let url = record.url.clone();
    let mut last_emit = Instant::now();
    let (_, downloaded) = crate::infra::providers::proton::download_to_path(
        &state.proton,
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

pub(super) async fn fetch_with_retry(
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
                    AppError::Network(crate::shared::security::network_error_message(&e))
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
pub(super) async fn cancel_active(state: &AppState, id: &str) {
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
