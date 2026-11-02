use crate::error::{AppError, AppResult};
use crate::models::MediaKind;
use std::path::Path;
use url::Url;

/// Media URLs may live on a provider other than Pawchive's own file host. The
/// client is still HTTPS-only and rejects local/private addresses.
pub fn validate_media_remote_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)?;
    if url.scheme() != "https" {
        return Err(AppError::UnsafeUrl(
            "only HTTPS media URLs are allowed".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl("URLs may not embed credentials".into()));
    }
    if url.port_or_known_default() != Some(443) {
        return Err(AppError::UnsafeUrl(
            "only the default HTTPS port is allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("URL has no host".into()))?
        .to_ascii_lowercase();
    if is_local_or_private_host(&host) {
        return Err(AppError::UnsafeUrl(
            "local and private media hosts are not allowed".into(),
        ));
    }
    Ok(url)
}

fn is_local_or_private_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']);
    if matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::1") {
        return true;
    }
    if let Ok(address) = host.parse::<std::net::IpAddr>() {
        return match address {
            std::net::IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
            std::net::IpAddr::V6(ip) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        };
    }
    host.ends_with(".local")
}

/// Redirect policy for media downloads. External providers are allowed, but
/// every hop must remain HTTPS on a public host.
pub fn media_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
        {
            return attempt.error("media redirect must use a public HTTPS URL");
        }
        match url.host_str() {
            Some(host) if !is_local_or_private_host(host) => attempt.follow(),
            _ => attempt.error("media redirect host is not allowed"),
        }
    })
}

/// A redirect policy that applies the same host and scheme rules to every hop.
/// Reqwest otherwise follows redirects to arbitrary hosts, which would defeat
/// the allowlist and could leak requests outside Pawchive.
pub fn redirect_policy(allowed_hosts: Vec<String>) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        if url.scheme() != "https" {
            return attempt.error("redirect to a non-HTTPS URL is not allowed");
        }
        if !url.username().is_empty() || url.password().is_some() {
            return attempt.error("redirect URL may not embed credentials");
        }
        if url.port_or_known_default() != Some(443) {
            return attempt.error("redirect to a non-default port is not allowed");
        }
        match url.host_str() {
            Some(host)
                if allowed_hosts
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(host)) =>
            {
                attempt.follow()
            }
            _ => attempt.error("redirect host is not in the Pawchive allowlist"),
        }
    })
}

/// External links are opened in the user's browser, never inside the webview.
pub fn validate_external_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(AppError::UnsafeUrl(
            "only http(s) links can be opened".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl("URLs may not embed credentials".into()));
    }
    if url.port_or_known_default() != Some(443) {
        return Err(AppError::UnsafeUrl(
            "only the default HTTPS port is allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("URL has no host".into()))?
        .to_ascii_lowercase();
    if matches!(
        host.as_str(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]"
    ) {
        return Err(AppError::UnsafeUrl(
            "local addresses are not allowed".into(),
        ));
    }
    Ok(url)
}

/// Media paths are relative to the file host (`/ab/cd/<sha>.mp4`).
pub fn validate_relative_path(raw: &str) -> AppResult<String> {
    let path = raw.trim();
    if path.is_empty() {
        return Err(AppError::Validation("file path is empty".into()));
    }
    if path.len() > 1024 {
        return Err(AppError::Validation("file path is too long".into()));
    }
    if !path.starts_with('/') {
        return Err(AppError::Validation("file path must be absolute".into()));
    }
    if path.contains("..") || path.contains('\\') || path.contains("//") {
        return Err(AppError::UnsafeUrl("path traversal is not allowed".into()));
    }
    if path.chars().any(|c| c.is_control()) {
        return Err(AppError::UnsafeUrl(
            "file path contains control characters".into(),
        ));
    }
    if path.contains(':') {
        return Err(AppError::UnsafeUrl(
            "file path may not contain a scheme".into(),
        ));
    }
    Ok(path.to_string())
}

pub fn validate_service(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty() || value.len() > 64 {
        return Err(AppError::Validation("invalid service name".into()));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation("invalid service name".into()));
    }
    Ok(value)
}

pub fn validate_id(raw: &str, label: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 128 {
        return Err(AppError::Validation(format!("invalid {label}")));
    }
    if value.contains('/')
        || value.contains('?')
        || value.contains('#')
        || value.chars().any(|c| c.is_control())
    {
        return Err(AppError::Validation(format!("invalid {label}")));
    }
    Ok(value.to_string())
}

pub fn validate_offset(offset: i64) -> AppResult<i64> {
    if offset < 0 {
        return Err(AppError::Validation("offset must not be negative".into()));
    }
    if offset % 50 != 0 {
        return Err(AppError::Validation(
            "offset must be a multiple of 50".into(),
        ));
    }
    if offset > 1_000_000 {
        return Err(AppError::Validation("offset is too large".into()));
    }
    Ok(offset)
}

pub fn validate_search_query(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    let len = value.chars().count();
    if len < crate::config::MIN_SEARCH_LEN {
        return Err(AppError::Validation(
            "search needs at least 3 characters".into(),
        ));
    }
    if len > crate::config::MAX_SEARCH_LEN {
        return Err(AppError::Validation(
            "search must be 200 characters or fewer".into(),
        ));
    }
    Ok(value.to_string())
}

/// Produce a filename that cannot escape its destination directory.
pub fn safe_filename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).to_string();
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => out.push('_'),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let trimmed = out
        .trim()
        .trim_start_matches('.')
        .trim_end_matches([' ', '.'])
        .trim();
    let mut name = if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    };
    if name.chars().count() > 180 {
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        let keep = 180usize.saturating_sub(ext.len() + 1);
        let stem: String = name.chars().take(keep).collect();
        name = if ext.is_empty() {
            stem
        } else {
            format!("{stem}.{ext}")
        };
    }
    if is_windows_reserved_name(&name) {
        name.insert(0, '_');
    }
    name
}

/// Windows refuses to create files whose base name is a DOS device name.
fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let bytes = stem.as_bytes();
    bytes.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && (b'1'..=b'9').contains(&bytes[3])
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

/// Sanitize creator-authored HTML before it reaches the webview.
pub fn sanitize_html(raw: &str) -> String {
    use ammonia::Builder;
    use std::collections::HashSet;

    let tags: HashSet<&str> = [
        "p",
        "br",
        "a",
        "span",
        "div",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "del",
        "blockquote",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "code",
        "pre",
        "hr",
        "img",
        "figure",
        "figcaption",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "sub",
        "sup",
        "small",
        "details",
        "summary",
    ]
    .into_iter()
    .collect();

    let mut attrs: std::collections::HashMap<&str, HashSet<&str>> =
        std::collections::HashMap::new();
    attrs.insert("a", ["href", "title", "target"].into_iter().collect());
    attrs.insert(
        "img",
        ["src", "alt", "title", "width", "height"]
            .into_iter()
            .collect(),
    );
    attrs.insert("td", ["colspan", "rowspan"].into_iter().collect());
    attrs.insert("th", ["colspan", "rowspan"].into_iter().collect());

    let mut builder = Builder::default();
    builder
        .tags(tags)
        .tag_attributes(attrs)
        .generic_attributes(HashSet::new())
        .url_schemes(["http", "https"].into_iter().collect())
        .link_rel(Some("noopener noreferrer nofollow"))
        .attribute_filter(|element, attribute, value| {
            if element == "a" && attribute == "target" {
                return Some("_blank".into());
            }
            if element == "img" && attribute == "src" {
                if value.starts_with("https://") {
                    return Some(value.into());
                }
                return None;
            }
            Some(value.into())
        });

    builder.clean(raw).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_external_media_but_rejects_private_hosts() {
        assert!(validate_media_remote_url("https://cdn.example.com/video.mp4").is_ok());
        assert!(validate_media_remote_url("http://cdn.example.com/video.mp4").is_err());
        assert!(validate_media_remote_url("https://127.0.0.1/video.mp4").is_err());
        assert!(validate_media_remote_url("https://192.168.1.2/video.mp4").is_err());
        assert!(validate_media_remote_url("https://user:pass@example.com/video.mp4").is_err());
    }

    #[test]
    fn rejects_credentials_in_urls() {
        assert!(validate_media_remote_url("https://user:pass@pawchive.pw/x").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("http://localhost:8080").is_err());
        assert!(validate_external_url("https://example.com/post").is_ok());
    }

    #[test]
    fn rejects_traversal_paths() {
        assert!(validate_relative_path("/ab/cd/file.mp4").is_ok());
        assert!(validate_relative_path("/ab/../../etc/passwd").is_err());
        assert!(validate_relative_path("https://evil/x").is_err());
        assert!(validate_relative_path("ab/cd").is_err());
    }

    #[test]
    fn sanitizes_script_content() {
        let dirty = r#"<p onclick="steal()">hi<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="http://evil/x.png"></p>"#;
        let clean = sanitize_html(dirty);
        assert!(!clean.contains("<script"));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("javascript:"));
        assert!(!clean.contains("http://evil"));
        assert!(clean.contains("<p>"));
        assert!(clean.contains("hi"));
    }

    #[test]
    fn makes_safe_file_names() {
        assert_eq!(safe_filename("../../etc/passwd"), "passwd");
        assert_eq!(safe_filename("a/b\\c.mp4"), "c.mp4");
        assert_eq!(safe_filename(".."), "download");
        assert_eq!(safe_filename(""), "download");
        assert_eq!(safe_filename("nul\0byte.mp3"), "nulbyte.mp3");
        assert_eq!(safe_filename("CON"), "_CON");
        assert_eq!(safe_filename("con.txt"), "_con.txt");
        assert_eq!(safe_filename("COM1.mp3"), "_COM1.mp3");
        assert_eq!(safe_filename("report."), "report");
        assert_eq!(safe_filename("report. "), "report");
    }

    #[test]
    fn detects_media_kinds() {
        assert_eq!(media_kind_for("cover.JPG"), MediaKind::Image);
        assert_eq!(media_kind_for("clip.mp4"), MediaKind::Video);
        assert_eq!(media_kind_for("song.flac"), MediaKind::Audio);
        assert_eq!(media_kind_for("book.pdf"), MediaKind::Document);
        assert_eq!(media_kind_for("archive.xyz"), MediaKind::Other);
    }

    #[test]
    fn validates_search_and_offsets() {
        assert!(validate_search_query("ab").is_err());
        assert!(validate_search_query("abc").is_ok());
        assert!(validate_offset(25).is_err());
        assert!(validate_offset(50).is_ok());
        assert!(validate_offset(-50).is_err());
    }
}
