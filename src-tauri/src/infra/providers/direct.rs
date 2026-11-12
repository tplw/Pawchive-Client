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

fn mega_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:www\.)?mega\.(?:nz|co\.nz|io)/(?:file/[a-z0-9_-]{6,16}#[a-z0-9_\-+/=]+|#![a-z0-9_-]{6,16}![a-z0-9_\-+/=]+)"#,
        )
        .expect("valid MEGA link regex")
    })
}

fn mega_folder_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:www\.)?mega\.(?:nz|co\.nz|io)/(?:folder/[a-z0-9_-]{6,16}#[a-z0-9_\-+/=]+|#F![a-z0-9_-]{6,16}![a-z0-9_\-+/=]+)"#,
        )
        .expect("valid MEGA folder regex")
    })
}

fn mega_protected_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:www\.)?mega\.(?:nz|co\.nz|io)/(?:(?:file|folder)/[a-z0-9_-]+)?#P![a-z0-9_\-]+"#,
        )
        .expect("valid MEGA password-link regex")
    })
}

fn proton_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:www\.)?drive\.proton\.me/urls/[a-z0-9_\-=]+(?:[?#][^\s"'<>]*)?"#,
        )
        .expect("valid Proton Drive link regex")
    })
}

/// Drive, Dropbox and GoFile links do not end in a media extension, so the
/// direct-media pass above cannot see them. Proton links have their own pass
/// because their password lives in the URL fragment. Keep the matches tight
/// enough that ordinary profile/folder pages are not turned into attachments.
fn provider_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:https?://)?(?:www\.)?(?:drive\.google\.com/(?:file/d/|open\?|uc\?|drive/folders/)|docs\.google\.com/(?:file/d/|uc\?)|dropbox\.com/(?:scl/fi/|s/|sh/)|gofile\.io/d/)[^\s"'<>]+"#,
        )
        .expect("valid provider link regex")
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
    // MEGA links have no media extension, so they need their own pass. Only
    // keep links whose key actually decodes as a MEGA file share.
    for found in mega_url_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        if !crate::infra::providers::mega::is_file_url(&url) {
            continue;
        }
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    // MEGA folders are expanded into their files by `get_post`.
    for found in mega_folder_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        if !crate::infra::providers::mega::is_folder_url(&url) {
            continue;
        }
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    // MEGA password-protected links use `#P!` instead of a key fragment.
    for found in mega_protected_url_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        if !crate::infra::providers::mega::is_protected_link(&url) {
            continue;
        }
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    // Proton Drive public links carry their password in the fragment and have
    // no media extension either.
    for found in proton_url_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        if !crate::infra::providers::proton::is_media_url(&url) {
            continue;
        }
        if seen.insert(url.clone()) {
            out.push(url);
        }
    }
    // Google Drive, Dropbox and GoFile share links also lack media
    // extensions. Their provider-specific resolvers decide whether the link
    // points at a playable file.
    for found in provider_url_regex().find_iter(text) {
        let Some(url) = normalize(found.as_str()) else {
            continue;
        };
        let valid = match crate::infra::providers::provider_for_url(&url) {
            crate::infra::providers::MediaProvider::GoogleDrive => {
                crate::infra::providers::remote::drive_file_id(&url).is_some()
                    || crate::infra::providers::remote::drive_folder_id(&url).is_some()
            }
            crate::infra::providers::MediaProvider::Dropbox => true,
            crate::infra::providers::MediaProvider::Gofile => {
                crate::infra::providers::remote::gofile_content_id(&url).is_some()
            }
            _ => false,
        };
        if !valid {
            continue;
        }
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
    fn extracts_password_protected_mega_links() {
        let text = r#"
            <a href="https://mega.nz/#P!AgFwfnUNgNEAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHxl3piJ-PeFLGsobpGcNPS6_rloUMHED4ClY_g0gDN1ZfY90DKw9YKl41vVccTZHgttETN3dBBIR1eL7qS_qXhg">protected</a>
        "#;
        let links = extract(text);
        assert_eq!(links.len(), 1);
        assert!(links[0].starts_with("https://mega.nz/#P!"));
        assert!(crate::infra::providers::mega::is_protected_link(&links[0]));
    }

    #[test]
    fn extracts_proton_share_links() {
        let text = r#"
            <a href="https://drive.proton.me/urls/AbC_123#correct-horse">proton</a>
            <a href="drive.proton.me/urls/Def-456#another-pass">scheme-less</a>
            <a href="https://proton.me/urls/nope#password">not drive</a>
        "#;
        assert_eq!(
            extract(text),
            vec![
                "https://drive.proton.me/urls/AbC_123#correct-horse".to_string(),
                "https://drive.proton.me/urls/Def-456#another-pass".to_string(),
            ]
        );
    }

    #[test]
    fn extracts_provider_share_links() {
        let text = r#"
            <a href="https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view?usp=sharing">drive</a>
            <a href="https://gofile.io/d/41qLzaRk">gofile</a>
            <a href="http://dropbox.com/scl/fi/abc/clip.mp4?rlkey=key&dl=0">dropbox</a>
            <a href="https://drive.google.com/drive/folders/abc">folder</a>
        "#;
        assert_eq!(
            extract(text),
            vec![
                "https://dropbox.com/scl/fi/abc/clip.mp4?rlkey=key&dl=0".to_string(),
                "https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view?usp=sharing"
                    .to_string(),
                "https://gofile.io/d/41qLzaRk".to_string(),
            ]
        );
    }

    #[test]
    fn extracts_provider_folder_links() {
        let text = r#"
            Gdrive: https://drive.google.com/drive/folders/1megyDZ_AK9oFl-OzFzIz7NcZ_s1l9wz-?usp=sharing
            Mega: https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ
            Bad: https://drive.google.com/drive/folders/abc
        "#;
        assert_eq!(
            extract(text),
            vec![
                "https://mega.nz/folder/RBA1wbzZ#9JumpYIWHYvgZ0RyL6wIBQ".to_string(),
                "https://drive.google.com/drive/folders/1megyDZ_AK9oFl-OzFzIz7NcZ_s1l9wz-?usp=sharing"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn ignores_non_media_links() {
        assert!(extract("https://example.com/about https://example.com/file.pdf").is_empty());
    }

    #[test]
    fn extracts_mega_file_links() {
        let text = r#"
            <a href="https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30">clip</a>
            <a href="https://mega.nz/#!Ue5VRSIQ!kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k">old</a>
            <a href="https://mega.nz/folder/abc#def">folder</a>
        "#;
        assert_eq!(
            extract(text),
            vec![
                "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30"
                    .to_string(),
                "https://mega.nz/#!Ue5VRSIQ!kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k"
                    .to_string(),
            ]
        );
    }
}
