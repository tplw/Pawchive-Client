use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;
use url::Url;

fn media_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?/[^\s"'<>]*?\.(?:mp4|m4v|webm|mov|ogv|mkv|avi|m3u8|ts|mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|jpg|jpeg|png|gif|webp|avif|bmp|jxl)(?:\?[^\s"'<>]*)?"#,
        )
        .expect("valid direct media regex")
    })
}

fn normalize(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_end_matches(['.', ',', ';', ':', ')', ']', '}'])
        .replace("&amp;", "&");
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if trimmed.starts_with("https://") {
        trimmed
    } else if trimmed.starts_with("http://") {
        trimmed.replacen("http://", "https://", 1)
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
        || url.path().is_empty()
    {
        return None;
    }
    Some(url.to_string())
}

/// Extract direct media links from post text, sanitized HTML or embed JSON.
/// Scheme-less links such as `cdn.example.com/file.mp4` are upgraded to HTTPS.
pub fn extract(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for found in media_url_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_direct_media_urls() {
        let text = r#"
            <p>Download <a href="https://cdn.example.com/videos/clip.mp4?token=abc">here</a></p>
            <img src="https://img.example.com/cover.jpg">
            <p>or example.net/audio/track.mp3</p>
            <p>http://files.example.org/old.m4a</p>
        "#;
        assert_eq!(
            extract(text),
            vec![
                "https://cdn.example.com/videos/clip.mp4?token=abc".to_string(),
                "https://img.example.com/cover.jpg".to_string(),
                "https://example.net/audio/track.mp3".to_string(),
                "https://files.example.org/old.m4a".to_string(),
            ]
        );
    }

    #[test]
    fn ignores_non_media_links() {
        assert!(extract("https://example.com/about https://example.com/file.pdf").is_empty());
    }
}
