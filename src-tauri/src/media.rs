use crate::config::PawchiveConfig;
use crate::error::{AppError, AppResult};
use crate::security::validate_media_remote_url;
use std::path::Path;

/// The player calls this before handing a media URL to the webview. Pawchive
/// paths and public HTTPS media providers are both supported.
pub fn validate_media_url(_cfg: &PawchiveConfig, raw: &str) -> AppResult<url::Url> {
    validate_media_remote_url(raw)
}

/// Read a user-selected subtitle file. SRT is converted to WebVTT so the
/// webview can render it without a third-party library.
pub fn read_subtitle(path: &str) -> AppResult<String> {
    let path = Path::new(path);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "vtt" | "srt") {
        return Err(AppError::Playback(
            "only .srt and .vtt subtitle files are supported".into(),
        ));
    }
    let metadata = std::fs::metadata(path)
        .map_err(|e| AppError::Io(format!("could not read subtitle file: {e}")))?;
    if metadata.len() > 5 * 1024 * 1024 {
        return Err(AppError::Playback("subtitle file is too large".into()));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| AppError::Io(format!("could not read subtitle file: {e}")))?;
    if ext == "srt" {
        Ok(srt_to_vtt(&text))
    } else {
        Ok(text)
    }
}

pub fn srt_to_vtt(input: &str) -> String {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::from("WEBVTT\n\n");
    let mut pending_blank = false;
    for line in normalized.lines() {
        let trimmed = line.trim();
        // Drop numeric cue counters that SRT uses between cues.
        if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if trimmed.is_empty() {
            if !pending_blank {
                out.push('\n');
                pending_blank = true;
            }
            continue;
        }
        pending_blank = false;
        let converted = if trimmed.contains("-->") {
            trimmed.replace(',', ".")
        } else {
            trimmed.to_string()
        };
        out.push_str(&converted);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_srt_to_vtt() {
        let srt = "1\n00:00:01,000 --> 00:00:02,500\nHello, world\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line\n";
        let vtt = srt_to_vtt(srt);
        assert!(vtt.starts_with("WEBVTT"));
        assert!(vtt.contains("00:00:01.000 --> 00:00:02.500"));
        assert!(vtt.contains("Hello, world"));
        assert!(!vtt.contains("\n1\n"));
    }

    #[test]
    fn rejects_media_from_foreign_hosts() {
        let cfg = PawchiveConfig::default();
        assert!(validate_media_url(&cfg, "https://file.pawchive.pw/data/a/b.mp4").is_ok());
        assert!(validate_media_url(&cfg, "https://cdn.example.com/a.mp4").is_ok());
        assert!(validate_media_url(&cfg, "http://file.pawchive.pw/a.mp4").is_err());
        assert!(validate_media_url(&cfg, "https://127.0.0.1/a.mp4").is_err());
    }
}
