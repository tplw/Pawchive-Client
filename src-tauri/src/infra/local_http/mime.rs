use std::path::Path;

pub(super) fn content_type(path: &Path) -> &'static str {
    content_type_for_name(&path.to_string_lossy())
}

/// Map a filename (including a MEGA attribute name) to the content type the
/// loopback server reports to the webview.
pub fn content_type_for_name(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" | "m4b" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "3gp" => "video/3gpp",
        "ts" => "video/mp2t",
        "m3u8" => "application/vnd.apple.mpegurl",
        "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}
