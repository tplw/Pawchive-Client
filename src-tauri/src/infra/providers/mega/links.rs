use super::crypto::decode_base64_url;
use crate::shared::security::media_kind_for;

/// A public MEGA file link: the node handle plus the fragment key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MegaLink {
    pub handle: String,
    pub key: String,
}

/// A public MEGA folder link: the folder handle plus the fragment key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MegaFolderLink {
    pub handle: String,
    pub key: String,
}

/// A file inside a public MEGA folder, in the standard
/// `folder/<handle>#<key>/file/<handle>` link form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MegaFolderFileLink {
    pub folder_handle: String,
    pub folder_key: String,
    pub file_handle: String,
}

/// One downloadable file discovered inside a MEGA folder.
#[derive(Debug, Clone)]
pub struct MegaFolderFile {
    pub handle: String,
    /// Base64url-encoded 32-byte file key.
    pub key: String,
    pub name: String,
}

/// Resolved metadata and decryption material for a public MEGA file.
#[derive(Debug, Clone)]
pub struct MegaFile {
    pub name: String,
    pub size: u64,
    pub download_url: String,
    /// AES-128 key for both the attributes and the file contents.
    pub key: [u8; 16],
    /// The first half of the 128-bit AES-CTR counter block.
    pub nonce: [u8; 8],
}

impl MegaFile {
    /// MEGA links have no extension until the encrypted attributes are read.
    /// Unknown extensions are treated as video because MEGA links in posts are
    /// almost always media and that keeps them in the playable queue.
    pub fn kind(&self) -> crate::shared::models::MediaKind {
        let kind = media_kind_for(&self.name);
        if kind == crate::shared::models::MediaKind::Other {
            crate::shared::models::MediaKind::Video
        } else {
            kind
        }
    }
}

fn is_mega_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "mega.nz" | "www.mega.nz" | "mega.co.nz" | "www.mega.co.nz" | "mega.io" | "www.mega.io"
    )
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
    let url = url::Url::parse(&candidate).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return None;
    }
    Some(url.to_string())
}

/// Parse either the current `mega.nz/file/<handle>#<key>` link or the legacy
/// `mega.nz/#!<handle>!<key>` form.
pub fn parse_file_link(raw: &str) -> Option<MegaLink> {
    // Cheap pre-check: `media_kind_for_file` calls this for every archive
    // attachment, so avoid URL parsing for ordinary file paths.
    if !raw
        .as_bytes()
        .windows(5)
        .any(|window| window.eq_ignore_ascii_case(b"mega."))
    {
        return None;
    }
    let url = url::Url::parse(&normalize(raw)?).ok()?;
    let host = url.host_str()?;
    if !is_mega_host(host) {
        return None;
    }
    let fragment = url.fragment()?.trim();
    let segments: Vec<&str> = url
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();
    let (handle, key) = if segments.len() >= 2 && segments[0].eq_ignore_ascii_case("file") {
        (segments[1].to_string(), fragment.to_string())
    } else {
        let rest = fragment.strip_prefix('!')?;
        let (handle, key) = rest.split_once('!')?;
        (handle.to_string(), key.to_string())
    };
    let handle = handle.trim();
    let key = key.trim();
    if !(6..=16).contains(&handle.len())
        || !handle
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    if decode_base64_url(key)?.len() != 32 {
        return None;
    }
    Some(MegaLink {
        handle: handle.to_string(),
        key: key.to_string(),
    })
}

pub fn is_file_url(raw: &str) -> bool {
    parse_file_link(raw).is_some()
}

/// Parse a public `mega.nz/folder/<handle>#<key>` link.
pub fn parse_folder_link(raw: &str) -> Option<MegaFolderLink> {
    if !raw
        .as_bytes()
        .windows(5)
        .any(|window| window.eq_ignore_ascii_case(b"mega."))
    {
        return None;
    }
    let url = url::Url::parse(&normalize(raw)?).ok()?;
    let host = url.host_str()?;
    if !is_mega_host(host) {
        return None;
    }
    let segments: Vec<&str> = url
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();
    let fragment = url.fragment()?.trim();
    let (handle, key) = if segments.len() >= 2 && segments[0].eq_ignore_ascii_case("folder") {
        (segments[1].trim(), fragment)
    } else {
        let (handle, key) = fragment
            .strip_prefix("F!")
            .and_then(|rest| rest.split_once('!'))?;
        (handle.trim(), key.trim())
    };
    if !(6..=16).contains(&handle.len())
        || !handle
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    let decoded = decode_base64_url(key)?;
    if decoded.len() != 16 && decoded.len() != 32 {
        return None;
    }
    Some(MegaFolderLink {
        handle: handle.to_string(),
        key: key.to_string(),
    })
}

pub fn is_folder_url(raw: &str) -> bool {
    parse_folder_link(raw).is_some()
}

/// Parse a file inside a folder:
/// `mega.nz/folder/<folderHandle>#<folderKey>/file/<fileHandle>`.
pub fn parse_folder_file_link(raw: &str) -> Option<MegaFolderFileLink> {
    if !raw
        .as_bytes()
        .windows(5)
        .any(|window| window.eq_ignore_ascii_case(b"mega."))
    {
        return None;
    }
    let url = url::Url::parse(&normalize(raw)?).ok()?;
    let host = url.host_str()?;
    if !is_mega_host(host) {
        return None;
    }
    let segments: Vec<&str> = url
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();
    let fragment = url.fragment()?.trim();
    let (folder_handle, folder_key, file_handle) =
        if segments.len() >= 2 && segments[0].eq_ignore_ascii_case("folder") {
            let (folder_key, rest) = fragment.split_once("/file/")?;
            (
                segments[1].trim(),
                folder_key,
                rest.split(['/', '?', '#']).next().unwrap_or(rest).trim(),
            )
        } else {
            let rest = fragment.strip_prefix("F!")?;
            let mut parts = rest.splitn(3, '!');
            (
                parts.next()?.trim(),
                parts.next()?.trim(),
                parts.next()?.trim(),
            )
        };
    if !(6..=16).contains(&folder_handle.len())
        || !folder_handle
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    if !(6..=16).contains(&file_handle.len())
        || !file_handle
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    let key = decode_base64_url(folder_key)?;
    if key.len() != 16 && key.len() != 32 {
        return None;
    }
    Some(MegaFolderFileLink {
        folder_handle: folder_handle.to_string(),
        folder_key: folder_key.to_string(),
        file_handle: file_handle.to_string(),
    })
}

pub fn is_media_url(raw: &str) -> bool {
    is_file_url(raw)
        || parse_folder_file_link(raw).is_some()
        || super::password::is_protected_link(raw)
}
