use crate::error::{AppError, AppResult};
use crate::models::MediaKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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

/// A short network error description that never includes the request URL.
/// Media URLs often contain expiring signatures, so they should not end up in
/// download records, logs or toasts.
pub fn network_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "the media request timed out".to_string()
    } else if error.is_connect() {
        "could not connect to the media host".to_string()
    } else if error.is_body() {
        "the media response was interrupted".to_string()
    } else {
        let text = error.to_string();
        text.split(" for url (").next().unwrap_or(&text).to_string()
    }
}

fn is_local_or_private_host(host: &str) -> bool {
    let host = host
        .trim()
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return true;
    }
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    if host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
        || host == "metadata"
    {
        return true;
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        return is_non_public_ip(address);
    }
    // The URL parser accepts legacy numeric IPv4 spellings such as
    // `2130706433` or `0x7f000001`. Reject those even though they are not
    // standard dotted-quad addresses.
    if let Some(address) = parse_legacy_ipv4(&host) {
        return is_non_public_ip(IpAddr::V4(address));
    }
    false
}

/// Return true for every address that could reach the local machine, the
/// local network, a cloud metadata service or another non-public target.
fn is_non_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || octets[0] == 0
                // Carrier-grade NAT (100.64.0.0/10).
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                // Reserved (240.0.0.0/4) and the limited broadcast address.
                || octets[0] >= 240
                // Benchmarking (198.18.0.0/15).
                || (octets[0] == 198 && (octets[1] & 0xfe) == 18)
                // IETF protocol assignments (192.0.0.0/24) and the
                // deprecated 6to4 relay anycast prefix (192.88.99.0/24).
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        }
        IpAddr::V6(ip) => {
            // IPv4-mapped addresses (::ffff:127.0.0.1) reach IPv4 targets.
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_non_public_ip(IpAddr::V4(mapped));
            }
            let segments = ip.segments();
            // Deprecated IPv4-compatible addresses (::127.0.0.1) and the
            // NAT64 well-known prefix (64:ff9b::/96) also reach IPv4.
            if segments[..6].iter().all(|segment| *segment == 0)
                || (segments[0] == 0x0064
                    && segments[1] == 0xff9b
                    && segments[2..6].iter().all(|segment| *segment == 0))
            {
                let v4 = Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                return is_non_public_ip(IpAddr::V4(v4));
            }
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                // Unique local (fc00::/7).
                || (segments[0] & 0xfe00) == 0xfc00
                // Link local (fe80::/10).
                || (segments[0] & 0xffc0) == 0xfe80
                // Deprecated site-local (fec0::/10).
                || (segments[0] & 0xffc0) == 0xfec0
                // Documentation (2001:db8::/32).
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

/// Parse the non-standard IPv4 forms accepted by browsers and the URL crate.
fn parse_legacy_ipv4(host: &str) -> Option<Ipv4Addr> {
    fn part(value: &str) -> Option<u64> {
        if let Some(hex) = value
            .strip_prefix("0x")
            .or_else(|| value.strip_prefix("0X"))
        {
            u64::from_str_radix(hex, 16).ok()
        } else if value.len() > 1 && value.starts_with('0') {
            u64::from_str_radix(&value[1..], 8).ok()
        } else {
            value.parse::<u64>().ok()
        }
    }

    let parts: Vec<&str> = host.split('.').collect();
    let number = match parts.as_slice() {
        [a] => part(a)?,
        [a, b] => (part(a)? << 24) | part(b)?,
        [a, b, c] => (part(a)? << 24) | (part(b)? << 16) | part(c)?,
        [a, b, c, d] => (part(a)? << 24) | (part(b)? << 16) | (part(c)? << 8) | part(d)?,
        _ => return None,
    };
    u32::try_from(number).ok().map(Ipv4Addr::from)
}

/// Reject hostnames that resolve to a non-public address. This is used by the
/// media client in addition to the literal-IP checks above so that DNS
/// rebinding cannot point a previously public host at localhost.
pub struct PublicDnsResolver;

impl reqwest::dns::Resolve for PublicDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let host_for_error = host.clone();
            let resolved = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { Box::new(error) })?;
            let addresses: Vec<SocketAddr> = resolved
                .filter(|address| !is_non_public_ip(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("refusing to connect to private address for {host_for_error}"),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
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
    let expected_port = if url.scheme() == "https" { 443 } else { 80 };
    if url.port_or_known_default() != Some(expected_port) {
        return Err(AppError::UnsafeUrl(
            "only default HTTP(S) ports are allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("URL has no host".into()))?
        .to_ascii_lowercase();
    if is_local_or_private_host(&host) {
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
    fn rejects_private_ipv6_and_legacy_ipv4_hosts() {
        assert!(validate_media_remote_url("https://[::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[::ffff:127.0.0.1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[64:ff9b::7f00:1]/video.mp4").is_err());
        assert!(validate_external_url("http://240.0.0.1/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[fe80::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://[fd00::1]/video.mp4").is_err());
        assert!(validate_media_remote_url("https://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_media_remote_url("https://localhost./video.mp4").is_err());
        assert!(validate_media_remote_url("https://service.localhost/video.mp4").is_err());
        assert!(validate_media_remote_url("https://2130706433/video.mp4").is_err());
        assert!(validate_media_remote_url("https://0x7f000001/video.mp4").is_err());
        assert!(validate_external_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn parses_legacy_ipv4_spellings() {
        assert_eq!(
            parse_legacy_ipv4("2130706433"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(
            parse_legacy_ipv4("0x7f000001"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(
            parse_legacy_ipv4("0177.0.0.1"),
            Some(Ipv4Addr::new(127, 0, 0, 1))
        );
        assert_eq!(parse_legacy_ipv4("example.com"), None);
    }

    #[test]
    fn classifies_non_public_addresses() {
        assert!(is_non_public_ip("127.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("100.64.0.1".parse().unwrap()));
        assert!(is_non_public_ip("169.254.1.1".parse().unwrap()));
        assert!(is_non_public_ip("::1".parse().unwrap()));
        assert!(is_non_public_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("fe80::1".parse().unwrap()));
        assert!(is_non_public_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("::127.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("64:ff9b::7f00:1".parse().unwrap()));
        assert!(is_non_public_ip("240.0.0.1".parse().unwrap()));
        assert!(is_non_public_ip("198.18.0.1".parse().unwrap()));
        assert!(!is_non_public_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_non_public_ip("2606:4700:4700::1111".parse().unwrap()));
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
