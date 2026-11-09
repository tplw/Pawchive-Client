use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
    Audio,
    Document,
    #[default]
    Other,
}

impl MediaKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Document => "document",
            Self::Other => "other",
        }
    }
}

pub fn file_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn media_kind_for(name: &str) -> MediaKind {
    match file_extension(name).as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "bmp" | "jxl" | "svg" => {
            MediaKind::Image
        }
        "mp4" | "webm" | "mkv" | "mov" | "avi" | "m4v" | "ogv" | "m3u8" | "ts" => MediaKind::Video,
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "opus" | "m4a" | "m4b" | "wma" | "aiff" => {
            MediaKind::Audio
        }
        "pdf" | "zip" | "rar" | "7z" | "tar" | "gz" | "txt" | "doc" | "docx" | "xls" | "xlsx"
        | "ppt" | "pptx" | "psd" | "clip" | "epub" | "cbz" | "cbr" => MediaKind::Document,
        _ => MediaKind::Other,
    }
}
