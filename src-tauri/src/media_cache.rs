use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;
use url::Url;

const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCacheProgress {
    pub request_id: Option<String>,
    pub url: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}

pub fn cache_dir(state: &AppState) -> PathBuf {
    state.app_data_dir.join("media-cache")
}

fn cache_path(state: &AppState, raw: &str) -> AppResult<PathBuf> {
    let url = Url::parse(raw)?;
    let mut hasher = Sha256::new();
    hasher.update(url.as_str().as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let extension = Path::new(url.path())
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 8
                && value.chars().all(|ch| ch.is_ascii_alphanumeric())
        })
        .unwrap_or_else(|| "bin".to_string());
    Ok(cache_dir(state).join(format!("{hash}.{extension}")))
}

pub fn cached_url(state: &AppState, raw: &str) -> AppResult<Option<String>> {
    let path = cache_path(state, raw)?;
    if path.is_file() {
        Ok(Some(state.media_server.url_for(&path)))
    } else {
        Ok(None)
    }
}

pub async fn cache_media(
    app: &AppHandle,
    state: &AppState,
    raw: &str,
    request_id: Option<String>,
    token: Option<&CancellationToken>,
) -> AppResult<String> {
    let url = crate::media::validate_media_url(&state.cfg, raw)?;
    let final_path = cache_path(state, raw)?;
    if final_path.is_file() {
        return Ok(state.media_server.url_for(&final_path));
    }

    let dir = cache_dir(state);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| AppError::Io(format!("could not create media cache: {error}")))?;
    let max_bytes = state
        .settings()
        .media_cache_size_mb
        .saturating_mul(1024 * 1024)
        .max(64 * 1024 * 1024);
    let temp_path = dir.join(format!(".part-{}", uuid::Uuid::new_v4()));
    let request = tokio::time::timeout(
        Duration::from_secs(120),
        state
            .http
            .get(url.clone())
            .header(reqwest::header::REFERER, "https://pawchive.pw/")
            .header(reqwest::header::RANGE, "bytes=0-")
            .send(),
    );
    let response = if let Some(token) = token {
        tokio::select! {
            _ = token.cancelled() => return Err(AppError::Cancelled),
            response = request => match response {
                Ok(response) => response.map_err(|error| {
                    AppError::Network(crate::security::network_error_message(&error))
                })?,
                Err(_) => return Err(AppError::Timeout),
            },
        }
    } else {
        match request.await {
            Ok(response) => response.map_err(|error| {
                AppError::Network(crate::security::network_error_message(&error))
            })?,
            Err(_) => return Err(AppError::Timeout),
        }
    };
    if !response.status().is_success() {
        return Err(AppError::Unavailable(format!(
            "media cache request answered HTTP {}",
            response.status().as_u16()
        )));
    }

    let total = response.content_length();
    if total.is_some_and(|length| length > max_bytes) {
        return Ok(url.to_string());
    }
    let file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|error| AppError::Io(format!("could not create media cache file: {error}")))?;
    let mut file = BufWriter::with_capacity(1024 * 1024, file);
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    let mut response = response;
    loop {
        let chunk = if let Some(token) = token {
            tokio::select! {
                _ = token.cancelled() => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(AppError::Cancelled);
                }
                chunk = tokio::time::timeout(CHUNK_TIMEOUT, response.chunk()) => {
                    match chunk {
                        Ok(chunk) => chunk.map_err(|error| {
                            AppError::Network(crate::security::network_error_message(&error))
                        })?,
                        Err(_) => {
                            drop(file);
                            let _ = tokio::fs::remove_file(&temp_path).await;
                            return Err(AppError::Timeout);
                        }
                    }
                }
            }
        } else {
            match tokio::time::timeout(CHUNK_TIMEOUT, response.chunk()).await {
                Ok(chunk) => chunk.map_err(|error| {
                    AppError::Network(crate::security::network_error_message(&error))
                })?,
                Err(_) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(AppError::Timeout);
                }
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        downloaded += chunk.len() as u64;
        if downloaded > max_bytes {
            drop(file);
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Ok(url.to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| AppError::Io(format!("could not write media cache: {error}")))?;
        if last_emit.elapsed() >= Duration::from_millis(150) {
            let _ = app.emit(
                "media-cache://progress",
                MediaCacheProgress {
                    request_id: request_id.clone(),
                    url: raw.to_string(),
                    downloaded,
                    total,
                },
            );
            last_emit = Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|error| AppError::Io(format!("could not flush media cache: {error}")))?;
    drop(file);

    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(|error| AppError::Io(format!("could not finish media cache: {error}")))?;
    prune_cache(&dir, max_bytes).await;
    let _ = app.emit(
        "media-cache://progress",
        MediaCacheProgress {
            request_id,
            url: raw.to_string(),
            downloaded,
            total: Some(downloaded),
        },
    );
    Ok(state.media_server.url_for(&final_path))
}

pub async fn clear(state: &AppState) -> AppResult<u64> {
    let dir = cache_dir(state);
    let mut removed = 0u64;
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(AppError::Io(format!("could not read media cache: {error}"))),
    };
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| AppError::Io(format!("could not read media cache entry: {error}")))?
    {
        let path = entry.path();
        if path.is_file() && tokio::fs::remove_file(&path).await.is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

pub(crate) async fn prune_cache(dir: &Path, max_bytes: u64) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total = 0u64;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".part-"))
        {
            continue;
        }
        let length = metadata.len();
        total = total.saturating_add(length);
        files.push((
            path,
            length,
            metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
        ));
    }
    files.sort_by_key(|entry| entry.2);
    for (path, length, _) in files {
        if total <= max_bytes {
            break;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            total = total.saturating_sub(length);
        }
    }
}

/// Remove abandoned temporary files left by an interrupted cache or transcode
/// request. Only files older than a day are touched so an in-flight download
/// from another window is never deleted.
pub(crate) async fn cleanup_stale(dir: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(24 * 60 * 60))
        .unwrap_or(std::time::UNIX_EPOCH);
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !(name.starts_with(".part-") || name.starts_with(".transcode-source-")) {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        let modified = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
        if modified < cutoff {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_names_are_stable_and_use_the_url_extension() {
        let url = "https://cdn.example.com/path/clip.MP4?token=abc";
        let parsed = Url::parse(url).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(parsed.as_str().as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        assert_eq!(
            format!("{hash}.mp4"),
            format!("{hash}.{}", {
                let extension = Path::new(parsed.path())
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap()
                    .to_ascii_lowercase();
                extension
            })
        );
    }
}
