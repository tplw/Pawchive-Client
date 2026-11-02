use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeProgress {
    pub request_id: Option<String>,
    pub phase: String,
    pub percent: Option<f64>,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
}

fn executable_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(value) = std::env::var("PAWCHIVE_FFMPEG") {
        let path = PathBuf::from(value);
        if path.is_file() {
            candidates.push(path);
        }
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let path = Path::new(directory).join(name);
        if path.is_file() {
            candidates.push(path);
        }
    }
    candidates
}

pub fn ffmpeg_path() -> Option<PathBuf> {
    executable_candidates("ffmpeg").into_iter().next()
}

fn ffprobe_path(ffmpeg: &Path) -> Option<PathBuf> {
    let sibling = ffmpeg.with_file_name(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    if sibling.is_file() {
        return Some(sibling);
    }
    executable_candidates("ffprobe").into_iter().next()
}

fn emit(
    app: &AppHandle,
    request_id: &Option<String>,
    phase: &str,
    percent: Option<f64>,
    downloaded: Option<u64>,
    total: Option<u64>,
) {
    let _ = app.emit(
        "transcode://progress",
        TranscodeProgress {
            request_id: request_id.clone(),
            phase: phase.to_string(),
            percent,
            downloaded,
            total,
        },
    );
}

fn output_path(state: &AppState, url: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    crate::media_cache::cache_dir(state).join(format!("transcoded-{hash}.mp4"))
}

async fn probe_duration(ffprobe: &Path, input: &Path) -> Option<f64> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(input)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn parse_timecode(value: &str) -> Option<f64> {
    let mut parts = value.trim().split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

pub async fn transcode_media(
    app: &AppHandle,
    state: &AppState,
    raw_url: &str,
    request_id: Option<String>,
) -> AppResult<String> {
    let url = crate::media::validate_media_url(&state.cfg, raw_url)?;
    let ffmpeg = ffmpeg_path().ok_or_else(|| {
        AppError::Validation(
            "ffmpeg is not installed. Install ffmpeg to enable transcoding.".into(),
        )
    })?;
    let output = output_path(state, url.as_str());
    if output.is_file() {
        return Ok(state.media_server.url_for(&output));
    }

    let cache_dir = crate::media_cache::cache_dir(state);
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|error| AppError::Io(format!("could not create transcode cache: {error}")))?;
    let source_path = cache_dir.join(format!(".transcode-source-{}.bin", uuid::Uuid::new_v4()));
    let result = async {
        let response = state
            .http
            .get(url.clone())
            .header(reqwest::header::REFERER, "https://pawchive.pw/")
            .send()
            .await
            .map_err(|error| AppError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "media source answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let total = response.content_length();
        let mut file = tokio::fs::File::create(&source_path)
            .await
            .map_err(|error| AppError::Io(format!("could not create transcode source: {error}")))?;
        let mut downloaded = 0u64;
        let mut last_emit = Instant::now();
        let mut response = response;
        loop {
            let chunk = response
                .chunk()
                .await
                .map_err(|error| AppError::Network(error.to_string()))?;
            let Some(chunk) = chunk else {
                break;
            };
            file.write_all(&chunk).await.map_err(|error| {
                AppError::Io(format!("could not write transcode source: {error}"))
            })?;
            downloaded += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(150) {
                emit(
                    app,
                    &request_id,
                    "download",
                    total.map(|total| (downloaded as f64 / total as f64) * 100.0),
                    Some(downloaded),
                    total,
                );
                last_emit = Instant::now();
            }
        }
        file.flush()
            .await
            .map_err(|error| AppError::Io(format!("could not flush transcode source: {error}")))?;
        drop(file);
        emit(app, &request_id, "transcode", Some(0.0), None, None);

        let duration = if let Some(ffprobe) = ffprobe_path(&ffmpeg) {
            probe_duration(&ffprobe, &source_path).await
        } else {
            None
        };
        let output_arg = output.to_string_lossy().to_string();
        let mut child = Command::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-i"])
            .arg(&source_path)
            .args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
            ])
            .arg(&output_arg)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| AppError::Io(format!("could not start ffmpeg: {error}")))?;
        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            let mut last_emit = Instant::now();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(value) = line.strip_prefix("out_time=") {
                    if let (Some(duration), Some(seconds)) = (duration, parse_timecode(value)) {
                        if last_emit.elapsed() >= Duration::from_millis(150) {
                            emit(
                                app,
                                &request_id,
                                "transcode",
                                Some(((seconds / duration) * 100.0).min(99.0)),
                                None,
                                None,
                            );
                            last_emit = Instant::now();
                        }
                    }
                } else if line == "progress=end" {
                    emit(app, &request_id, "transcode", Some(100.0), None, None);
                }
            }
        }
        let status = child
            .wait()
            .await
            .map_err(|error| AppError::Io(format!("could not wait for ffmpeg: {error}")))?;
        if !status.success() {
            return Err(AppError::Unavailable(
                "ffmpeg could not transcode this media file".into(),
            ));
        }
        let output_size = tokio::fs::metadata(&output)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let max_bytes = state
            .settings()
            .media_cache_size_mb
            .saturating_mul(1024 * 1024)
            .max(64 * 1024 * 1024);
        if output_size > max_bytes {
            let _ = tokio::fs::remove_file(&output).await;
            return Err(AppError::Validation(
                "transcoded file exceeds the media cache limit".into(),
            ));
        }
        crate::media_cache::prune_cache(&cache_dir, max_bytes).await;
        Ok(state.media_server.url_for(&output))
    }
    .await;

    let _ = tokio::fs::remove_file(&source_path).await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&output).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_timecodes() {
        assert_eq!(parse_timecode("00:00:01.500000"), Some(1.5));
        assert_eq!(parse_timecode("01:02:03.000000"), Some(3723.0));
        assert_eq!(parse_timecode("bad"), None);
    }
}
