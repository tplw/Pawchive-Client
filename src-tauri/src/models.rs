use crate::security::{file_extension, media_kind_for, safe_filename};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

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

/// Accepts the several timestamp shapes the archive uses: Unix seconds as a
/// number, numeric strings, and ISO-8601 strings with or without an offset.
pub fn parse_timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                return None;
            }
            if let Ok(n) = s.parse::<i64>() {
                return Some(n);
            }
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp());
            }
            for fmt in [
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%d",
            ] {
                if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
                    return Some(dt.and_utc().timestamp());
                }
                if fmt == "%Y-%m-%d" {
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(s, fmt) {
                        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp());
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn vec_or_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

fn flex_ts<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    let value = Value::deserialize(deserializer)?;
    Ok(parse_timestamp(&value))
}

/// Some archive records use JSON null where the schema says string. Treat
/// null and missing values as an empty string so one malformed field cannot
/// reject an otherwise usable post or comment.
fn string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn bool_or_default<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or_default())
}

fn i64_or_default<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<i64>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CreatorSummary {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default)]
    pub public_id: Option<String>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub indexed: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub updated: Option<i64>,
    /// Number of archive users who favourited this creator. The API exposes it
    /// as a popularity signal; it is not local state.
    #[serde(default)]
    pub favorited: Option<i64>,
    /// Whether the local user has starred this creator.
    #[serde(default)]
    pub is_favorite: bool,
    /// The archive relays creator metadata before any of their posts have been
    /// imported. `None` means the archive did not report the field, which we
    /// treat as imported so older data never shows a false warning.
    #[serde(default)]
    pub ever_imported: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CreatorProfile {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default)]
    pub public_id: Option<String>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub indexed: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub updated: Option<i64>,
    #[serde(default)]
    pub relation_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    /// Whether the archive has ever imported this creator. Mirrors
    /// `CreatorSummary::ever_imported`.
    #[serde(default)]
    pub ever_imported: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct FileRef {
    #[serde(default, deserialize_with = "string_or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub path: String,
    #[serde(default)]
    pub preview_only: Option<bool>,
    #[serde(default)]
    pub node: Option<i64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl FileRef {
    /// Some archive entries expose a temporary direct URL for preview-only
    /// files. When present it is a public HTTPS media URL we can play/download.
    pub fn temp_url(&self) -> Option<&str> {
        self.extra
            .get("temp_url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// Deferred/streamed attachments have no archive-relative `path`. The
    /// archive instead returns a signed download URL next to the streaming
    /// `temp_url`, which is what a download should point at.
    pub fn temp_download_url(&self) -> Option<&str> {
        self.extra
            .get("temp_download_url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// List/search responses mark streamed attachments as deferred but only
    /// the single-post response includes their signed URLs. The marker is
    /// still enough to count and classify the attachment in summaries.
    pub fn is_deferred(&self) -> bool {
        self.extra
            .get("deferred")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    /// A file is usable if it has a stored path, a temporary remote URL or is
    /// a deferred attachment. Deferred attachments only get URLs when a post
    /// is opened individually.
    pub fn has_source(&self) -> bool {
        !self.path.trim().is_empty()
            || self.temp_url().is_some()
            || self.temp_download_url().is_some()
            || self.is_deferred()
    }
}

/// The archive occasionally gives a cover image a video-looking `name`.
/// Prefer the actual path extension when it is a recognised media type.
pub fn media_kind_for_file(file: &FileRef) -> MediaKind {
    if crate::mega::is_media_url(&file.path) {
        // The real name lives in encrypted MEGA metadata. Treat links as
        // video until `get_post` resolves the extension so they stay playable.
        return MediaKind::Video;
    }
    let path_kind = media_kind_for(&file.path);
    if path_kind != MediaKind::Other {
        return path_kind;
    }
    let name = if file.name.trim().is_empty() {
        &file.path
    } else {
        &file.name
    };
    media_kind_for(name)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Post {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub user: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub title: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub content: String,
    #[serde(default)]
    pub embed: Value,
    #[serde(default, deserialize_with = "bool_or_default")]
    pub shared_file: bool,
    #[serde(default, deserialize_with = "flex_ts")]
    pub added: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub published: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub edited: Option<i64>,
    #[serde(default)]
    pub file: Option<FileRef>,
    #[serde(default, deserialize_with = "vec_or_empty")]
    pub attachments: Vec<FileRef>,
    #[serde(default)]
    pub substring: Option<String>,
    #[serde(default)]
    pub preview_state: Option<String>,
    #[serde(default)]
    pub has_full: Option<bool>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub next: Option<String>,
    #[serde(default)]
    pub prev: Option<String>,
    #[serde(default)]
    pub poll: Value,
    #[serde(default)]
    pub captions: Value,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Post {
    pub fn primary_file(&self) -> Option<&FileRef> {
        self.file.as_ref().filter(|f| f.has_source())
    }

    pub fn all_files(&self) -> Vec<&FileRef> {
        let mut out = Vec::new();
        if let Some(file) = self.primary_file() {
            out.push(file);
        }
        out.extend(self.attachments.iter().filter(|a| a.has_source()));
        out
    }

    /// Direct media links embedded in the post text or embed payload. Some
    /// creators post `cdn.example.com/clip.mp4` instead of using attachments.
    pub fn direct_media_files(&self) -> Vec<FileRef> {
        let embed = serde_json::to_string(&self.embed).unwrap_or_default();
        let text = format!("{} {}", self.content, embed);
        let existing_paths: HashSet<String> = self
            .all_files()
            .iter()
            .map(|file| file.path.trim_matches('/').to_string())
            .collect();
        let existing_names: HashSet<String> = self
            .all_files()
            .iter()
            .map(|file| {
                safe_filename(if file.name.is_empty() {
                    &file.path
                } else {
                    &file.name
                })
            })
            .collect();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for raw in crate::direct_media::extract(&text) {
            let parsed = match url::Url::parse(&raw) {
                Ok(url) => url,
                Err(_) => continue,
            };
            let path = parsed.path().trim_matches('/');
            if existing_paths.contains(path) {
                continue;
            }
            let name = if let Some(link) = crate::mega::parse_file_link(&raw) {
                // `get_post` replaces this placeholder with the real filename
                // from the encrypted MEGA attributes.
                safe_filename(&format!("mega-{}", link.handle))
            } else if let Some(link) = crate::mega::parse_folder_link(&raw) {
                safe_filename(&format!("mega-folder-{}", link.handle))
            } else if let Some(id) = crate::remote_media::drive_file_id(&raw) {
                safe_filename(&format!("drive-{id}"))
            } else if let Some(id) = crate::remote_media::drive_folder_id(&raw) {
                safe_filename(&format!("drive-folder-{id}"))
            } else if let Some(id) = crate::remote_media::gofile_content_id(&raw) {
                safe_filename(&format!("gofile-{id}"))
            } else {
                let file_name = path.rsplit('/').next().unwrap_or("media");
                safe_filename(file_name)
            };
            if existing_names.contains(&name) || !seen.insert(raw.clone()) {
                continue;
            }
            out.push(FileRef {
                name,
                path: raw,
                preview_only: Some(false),
                node: None,
                extra: BTreeMap::new(),
            });
        }
        out
    }

    pub fn all_files_including_direct(&self) -> Vec<FileRef> {
        let mut files: Vec<FileRef> = self.all_files().into_iter().cloned().collect();
        files.extend(self.direct_media_files());
        files
    }

    /// Posts relayed from Kemono are previews that Pawchive has not archived.
    /// Everything else (including older records with no `origin`) is imported.
    pub fn is_imported(&self) -> bool {
        self.origin
            .as_deref()
            .map(|origin| !origin.trim().eq_ignore_ascii_case("kemono"))
            .unwrap_or(true)
    }

    /// Imported posts with `has_full: false` are missing at least one file
    /// because it exceeded the archive's size limit. Unimported previews also
    /// report `has_full: false`, but they are handled separately.
    pub fn exceeds_archive_limit(&self) -> bool {
        self.is_imported() && self.has_full == Some(false)
    }

    /// A post that exceeded the size limit is still useful when it has a
    /// non-image file that can still be played or downloaded. Images are
    /// ignored here because over-limit image sets are exactly what the filter
    /// targets. Deferred attachments and temporary provider URLs count as
    /// usable because the archive can still stream them from the post view.
    pub fn has_available_non_image_attachment(&self) -> bool {
        self.all_files_including_direct().iter().any(|file| {
            media_kind_for_file(file) != MediaKind::Image
                && !file.preview_only.unwrap_or(false)
                && file.has_source()
        })
    }

    /// Whether this post should be hidden by the optional unavailable-content
    /// filter. A post stays visible when it still has a playable or
    /// downloadable non-image file, even if the archive did not import it or
    /// dropped files for exceeding the size limit.
    pub fn is_unavailable(&self) -> bool {
        if self.has_available_non_image_attachment() {
            return false;
        }
        !self.is_imported() || self.exceeds_archive_limit()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Announcement {
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub user_id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub hash: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub content: String,
    #[serde(default, deserialize_with = "flex_ts")]
    pub added: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CommentRevision {
    #[serde(default, deserialize_with = "i64_or_default")]
    pub id: i64,
    #[serde(default, deserialize_with = "string_or_default")]
    pub content: String,
    #[serde(default, deserialize_with = "flex_ts")]
    pub added: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Comment {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default, deserialize_with = "string_or_default")]
    pub commenter: String,
    #[serde(default)]
    pub commenter_name: Option<String>,
    #[serde(default, deserialize_with = "string_or_default")]
    pub content: String,
    #[serde(default, deserialize_with = "flex_ts")]
    pub published: Option<i64>,
    #[serde(default, deserialize_with = "vec_or_empty")]
    pub revisions: Vec<CommentRevision>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Revision {
    #[serde(default, deserialize_with = "i64_or_default")]
    pub revision_id: i64,
    #[serde(flatten)]
    pub post: Post,
}

/* ------------------------------------------------------------------------- */
/* UI DTOs                                                                   */
/* ------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub path: String,
    /// URL handed to the player. Deferred attachments use the archive's
    /// streaming URL (HLS) when one is available.
    pub url: String,
    /// URL used when saving the file to disk. The archive exposes a separate
    /// signed download URL for deferred attachments, which may differ from the
    /// streaming URL.
    pub download_url: String,
    pub thumbnail_url: Option<String>,
    pub kind: MediaKind,
    /// Host that actually serves the file (Pawchive, MEGA, Google Drive…).
    pub provider: crate::providers::MediaProvider,
    pub ext: String,
    pub preview_only: bool,
}

impl Attachment {
    pub fn new(cfg: &crate::config::PawchiveConfig, file: &FileRef) -> Option<Self> {
        let temp_url = file
            .temp_url()
            .and_then(|raw| crate::security::validate_media_remote_url(raw).ok())
            .map(|url| url.to_string());
        let temp_download_url = file
            .temp_download_url()
            .and_then(|raw| crate::security::validate_media_remote_url(raw).ok())
            .map(|url| url.to_string());
        let has_path = !file.path.trim().is_empty();
        let (path, fallback_url) = if has_path {
            if file.path.starts_with("https://") {
                let url = crate::security::validate_media_remote_url(&file.path).ok()?;
                (url.to_string(), url.to_string())
            } else {
                let path = crate::security::validate_relative_path(&file.path).ok()?;
                let url = cfg.file_url(&path);
                (path, url)
            }
        } else {
            // Deferred attachments only carry signed URLs. Derive a stable,
            // path-like identifier from the URL path so queue ids, playlist
            // entries and resume positions keep working.
            let remote = temp_download_url.as_deref().or(temp_url.as_deref())?;
            let parsed = url::Url::parse(remote).ok()?;
            let remote_path = parsed.path().trim_start_matches('/');
            if remote_path.is_empty() {
                return None;
            }
            (format!("/{remote_path}"), remote.to_string())
        };
        let name = if file.name.trim().is_empty() {
            safe_filename(&path)
        } else {
            safe_filename(&file.name)
        };
        let kind = media_kind_for_file(file);
        let url = temp_url.clone().unwrap_or(fallback_url);
        let download_url = temp_download_url.clone().unwrap_or_else(|| url.clone());
        let thumbnail_url = if kind == MediaKind::Image {
            Some(if !has_path || file.path.starts_with("https://") {
                url.clone()
            } else {
                cfg.thumbnail_url(&path)
            })
        } else {
            None
        };
        let ext = file_extension(&name);
        let provider = crate::providers::provider_for_url(&url);
        Some(Self {
            url,
            download_url,
            name,
            path,
            thumbnail_url,
            kind,
            provider,
            ext,
            preview_only: file.preview_only.unwrap_or(false)
                && temp_url.is_none()
                && temp_download_url.is_none(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PostSummary {
    pub id: String,
    pub service: String,
    pub user: String,
    pub creator_name: Option<String>,
    pub title: String,
    pub excerpt: String,
    pub published: Option<i64>,
    pub added: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub attachment_count: usize,
    pub media_kinds: Vec<MediaKind>,
    pub preview_state: Option<String>,
    pub has_full: Option<bool>,
    /// False when the post is a Kemono preview the archive has not imported.
    pub imported: bool,
    /// True when imported files were dropped for exceeding the archive limit.
    pub exceeds_limit: bool,
    /// True when the optional unavailable-post filter should hide this post.
    pub unavailable: bool,
}

impl PostSummary {
    pub fn from_post(
        cfg: &crate::config::PawchiveConfig,
        post: &Post,
        creator_name: Option<String>,
    ) -> Self {
        let mut kinds: Vec<MediaKind> = Vec::new();
        let mut thumbnail_url = None;
        let files = post.all_files_including_direct();
        for file in &files {
            let kind = media_kind_for_file(file);
            if !kinds.contains(&kind) {
                kinds.push(kind);
            }
            if thumbnail_url.is_none() && kind == MediaKind::Image {
                thumbnail_url = Some(if let Some(temp) = file.temp_url() {
                    temp.to_string()
                } else if file.path.starts_with("https://") {
                    file.path.clone()
                } else {
                    cfg.thumbnail_url(&file.path)
                });
            }
        }
        let excerpt_source = post
            .substring
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| strip_html(&post.content));
        PostSummary {
            id: post.id.clone(),
            service: post.service.clone(),
            user: post.user.clone(),
            creator_name,
            title: if post.title.trim().is_empty() {
                "Untitled post".to_string()
            } else {
                post.title.clone()
            },
            excerpt: truncate(&strip_html(&excerpt_source), 240),
            published: post.published.or(post.added),
            added: post.added,
            thumbnail_url,
            attachment_count: files.len(),
            media_kinds: kinds,
            preview_state: post.preview_state.clone(),
            has_full: post.has_full,
            imported: post.is_imported(),
            exceeds_limit: post.exceeds_archive_limit(),
            unavailable: post.is_unavailable(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostDetail {
    pub post: Post,
    pub attachments: Vec<Attachment>,
    pub creator: Option<CreatorSummary>,
    pub next: Option<String>,
    pub prev: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub posts: Vec<PostSummary>,
    pub creators: Vec<CreatorSummary>,
    pub offset: i64,
    pub has_more: bool,
    pub query: String,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorPage {
    pub items: Vec<CreatorSummary>,
    pub offset: i64,
    pub total: i64,
    pub has_more: bool,
    pub synced: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPage {
    pub items: Vec<PostSummary>,
    pub offset: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProgress {
    pub file_path: String,
    pub position: f64,
    pub duration: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub item_count: i64,
    pub cover_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: i64,
    pub playlist_id: i64,
    pub service: String,
    pub creator_id: String,
    pub post_id: String,
    pub media_path: String,
    pub media_url: String,
    pub title: String,
    pub creator_name: String,
    pub thumbnail_url: Option<String>,
    pub media_kind: String,
    pub added_at: i64,
    /// Local path of a completed download matching this item's media URL.
    #[serde(default)]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub file_name: String,
    pub media_kind: String,
    pub title: String,
    pub creator_name: String,
    pub service: String,
    pub creator_id: String,
    pub post_id: String,
    pub playlist_id: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub total_bytes: Option<i64>,
    pub downloaded_bytes: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub creator_name: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub creator_id: String,
    #[serde(default)]
    pub post_id: String,
    #[serde(default)]
    pub playlist_id: Option<i64>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub media_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountSession {
    pub username: String,
    pub session: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub logged_in: bool,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedCreator {
    pub service: String,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub sidebar_visible: bool,
    pub volume: f64,
    pub playback_speed: f64,
    pub download_dir: String,
    pub hidden_keywords: Vec<String>,
    pub hide_ai_posts: bool,
    pub post_card_size: String,
    pub autoplay_next: bool,
    pub resume_playback: bool,
    pub reduce_motion: bool,
    pub accent_color: String,
    pub hide_no_media: bool,
    /// Hide posts the archive has not imported or that lost files to the
    /// archive size limit without a usable non-image attachment.
    pub hide_unavailable_posts: bool,
    pub auto_detect_asmr: bool,
    pub auto_sync_favorites: bool,
    pub cache_size_mb: u64,
    pub media_cache_size_mb: u64,
    pub cache_media: bool,
    pub transcode_media: bool,
    pub load_ahead_pages: u64,
    pub show_creator_updated: bool,
    pub auto_check_updates: bool,
    /// Latest release the user dismissed, so the update prompt only appears
    /// once per version.
    pub dismissed_update_version: String,
    /// Creators the user has blocked. Their posts and profiles are hidden from
    /// browsing, search and direct links.
    pub blocked_creators: Vec<BlockedCreator>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sidebar_visible: true,
            volume: 1.0,
            playback_speed: 1.0,
            download_dir: String::new(),
            hidden_keywords: Vec::new(),
            hide_ai_posts: false,
            post_card_size: if cfg!(any(target_os = "ios", target_os = "android")) {
                "small"
            } else {
                "medium"
            }
            .into(),
            autoplay_next: true,
            resume_playback: true,
            reduce_motion: false,
            accent_color: "#d6aea8".into(),
            hide_no_media: false,
            hide_unavailable_posts: false,
            auto_detect_asmr: true,
            auto_sync_favorites: false,
            cache_size_mb: 64,
            media_cache_size_mb: 512,
            cache_media: false,
            transcode_media: false,
            load_ahead_pages: 1,
            show_creator_updated: false,
            auto_check_updates: true,
            dismissed_update_version: String::new(),
            blocked_creators: Vec::new(),
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> Result<(), crate::error::AppError> {
        use crate::error::AppError;
        if !self.volume.is_finite() || !(0.0..=1.0).contains(&self.volume) {
            return Err(AppError::Validation(
                "volume must be between 0 and 1".into(),
            ));
        }
        if !self.playback_speed.is_finite() || !(0.25..=4.0).contains(&self.playback_speed) {
            return Err(AppError::Validation(
                "playback speed is out of range".into(),
            ));
        }
        if !matches!(self.post_card_size.as_str(), "small" | "medium" | "large") {
            return Err(AppError::Validation("invalid post card size".into()));
        }
        if !(8..=2048).contains(&self.cache_size_mb) {
            return Err(AppError::Validation(
                "cache size must be between 8 and 2048 MB".into(),
            ));
        }
        if !(64..=8192).contains(&self.media_cache_size_mb) {
            return Err(AppError::Validation(
                "media cache size must be between 64 and 8192 MB".into(),
            ));
        }
        if !(1..=5).contains(&self.load_ahead_pages) {
            return Err(AppError::Validation(
                "load-ahead pages must be between 1 and 5".into(),
            ));
        }
        if self.hidden_keywords.len() > 100 {
            return Err(AppError::Validation(
                "too many hidden keywords (max 100)".into(),
            ));
        }
        if self
            .hidden_keywords
            .iter()
            .any(|keyword| keyword.chars().count() > 80)
        {
            return Err(AppError::Validation(
                "each hidden keyword must be 80 characters or fewer".into(),
            ));
        }
        if self.blocked_creators.len() > 5000 {
            return Err(AppError::Validation(
                "too many blocked creators (max 5000)".into(),
            ));
        }
        if self.blocked_creators.iter().any(|creator| {
            creator.service.chars().count() > 40
                || creator.id.chars().count() > 200
                || creator.name.chars().count() > 300
        }) {
            return Err(AppError::Validation(
                "blocked creator details are too long".into(),
            ));
        }
        let accent = self.accent_color.as_bytes();
        if accent.len() != 7
            || accent[0] != b'#'
            || !accent[1..].iter().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::Validation(
                "accent color must be a hex color like #d6aea8".into(),
            ));
        }
        Ok(())
    }
}

pub fn strip_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn truncate(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

pub fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mixed_timestamp_shapes() {
        assert_eq!(
            parse_timestamp(&serde_json::json!(1672534800)),
            Some(1672534800)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("1672534800")),
            Some(1672534800)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("2021-01-24T08:54:38")),
            Some(1611478478)
        );
        assert_eq!(
            parse_timestamp(&serde_json::json!("2021-01-24T08:54:38.973913")),
            Some(1611478478)
        );
        assert_eq!(parse_timestamp(&serde_json::json!(null)), None);
        assert_eq!(parse_timestamp(&serde_json::json!("not a date")), None);
    }

    #[test]
    fn deserializes_post_with_unknown_fields() {
        let raw = serde_json::json!({
            "id": "1836570",
            "user": "6570768",
            "service": "fanbox",
            "title": "Hello",
            "content": "<p>Hi</p>",
            "embed": {},
            "shared_file": false,
            "added": "2021-03-30T18:00:05.973913",
            "published": "2021-01-24T17:54:38",
            "edited": null,
            "file": {"name": "a.jpg", "path": "/aa/bb/a.jpg", "preview_only": true},
            "attachments": [{"name": "b.mp4", "path": "/cc/dd/b.mp4"}],
            "brand_new_field": {"future": true}
        });
        let post: Post = serde_json::from_value(raw).unwrap();
        assert_eq!(post.id, "1836570");
        assert_eq!(post.all_files().len(), 2);
        assert!(post.extra.contains_key("brand_new_field"));
        assert!(post.added.is_some());
    }

    #[test]
    fn tolerates_missing_and_null_fields() {
        let raw = serde_json::json!({"id": "1", "title": null, "attachments": null, "file": null});
        let post: Post = serde_json::from_value(raw).unwrap();
        assert_eq!(post.title, "");
        assert!(post.attachments.is_empty());
        assert!(post.all_files().is_empty());
    }

    #[test]
    fn treats_kemono_previews_as_unimported() {
        let preview: Post = serde_json::from_value(serde_json::json!({
            "id": "1",
            "origin": "kemono"
        }))
        .unwrap();
        assert!(!preview.is_imported());

        let imported: Post = serde_json::from_value(serde_json::json!({
            "id": "2",
            "origin": "import"
        }))
        .unwrap();
        assert!(imported.is_imported());

        let legacy: Post = serde_json::from_value(serde_json::json!({"id": "3"})).unwrap();
        assert!(legacy.is_imported());
    }

    #[test]
    fn flags_imported_posts_that_lost_files_to_the_size_limit() {
        let all_images: Post = serde_json::from_value(serde_json::json!({
            "id": "1",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "2.png", "path": "/bb/2.png", "preview_only": true}
            ]
        }))
        .unwrap();
        assert!(all_images.exceeds_archive_limit());
        assert!(all_images.is_unavailable());

        let mixed: Post = serde_json::from_value(serde_json::json!({
            "id": "2",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "clip.mp4", "path": "/bb/clip.mp4"}
            ]
        }))
        .unwrap();
        assert!(mixed.exceeds_archive_limit());
        assert!(mixed.has_available_non_image_attachment());
        assert!(!mixed.is_unavailable());

        let deferred_only: Post = serde_json::from_value(serde_json::json!({
            "id": "5",
            "origin": "import",
            "has_full": false,
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true},
                {"name": "set.zip", "deferred": true, "temp_url": "https://example.com/set.zip"}
            ]
        }))
        .unwrap();
        assert!(deferred_only.exceeds_archive_limit());
        assert!(deferred_only.has_available_non_image_attachment());
        assert!(!deferred_only.is_unavailable());

        let cloud_media: Post = serde_json::from_value(serde_json::json!({
            "id": "6",
            "origin": "import",
            "has_full": false,
            "content": "<p><a href=\"https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30\">video</a></p>",
            "attachments": [
                {"name": "1.png", "path": "/aa/1.png", "preview_only": true}
            ]
        }))
        .unwrap();
        assert!(cloud_media.exceeds_archive_limit());
        assert!(cloud_media.has_available_non_image_attachment());
        assert!(!cloud_media.is_unavailable());

        let preview_with_cloud_media: Post = serde_json::from_value(serde_json::json!({
            "id": "7",
            "origin": "kemono",
            "content": "<p><a href=\"https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view\">video</a></p>"
        }))
        .unwrap();
        assert!(!preview_with_cloud_media.is_imported());
        assert!(preview_with_cloud_media.has_available_non_image_attachment());
        assert!(!preview_with_cloud_media.is_unavailable());

        let complete: Post = serde_json::from_value(serde_json::json!({
            "id": "3",
            "origin": "import",
            "has_full": true,
            "attachments": [{"name": "1.png", "path": "/aa/1.png", "preview_only": true}]
        }))
        .unwrap();
        assert!(!complete.exceeds_archive_limit());
        assert!(!complete.is_unavailable());

        let preview: Post = serde_json::from_value(serde_json::json!({
            "id": "4",
            "origin": "kemono",
            "has_full": false
        }))
        .unwrap();
        assert!(!preview.exceeds_archive_limit());
        assert!(preview.is_unavailable());
    }

    #[test]
    fn includes_direct_media_links_in_posts() {
        let cfg = crate::config::PawchiveConfig::default();
        let post = Post {
            id: "1".into(),
            service: "patreon".into(),
            user: "2".into(),
            title: "Direct media".into(),
            content: r#"<p>Watch <a href="https://cdn.example.com/videos/clip.mp4">this</a></p>"#
                .into(),
            ..Default::default()
        };
        let files = post.all_files_including_direct();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "clip.mp4");
        assert_eq!(files[0].path, "https://cdn.example.com/videos/clip.mp4");
        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 1);
        assert_eq!(summary.media_kinds, vec![MediaKind::Video]);
    }

    #[test]
    fn prefers_the_real_path_extension_for_media_kind() {
        let file = FileRef {
            name: "Tetoween ESP.mp4".into(),
            path: "/aa/bb/cover.jpg".into(),
            ..Default::default()
        };
        assert_eq!(media_kind_for_file(&file), MediaKind::Image);
        let video = FileRef {
            name: "cover.jpg".into(),
            path: "/aa/bb/clip.mp4".into(),
            ..Default::default()
        };
        assert_eq!(media_kind_for_file(&video), MediaKind::Video);
    }

    #[test]
    fn prefers_public_temp_media_urls() {
        let cfg = crate::config::PawchiveConfig::default();
        let file = FileRef {
            name: "clip.mp4".into(),
            path: "/cc/dd/clip.mp4".into(),
            preview_only: Some(true),
            extra: serde_json::from_value(serde_json::json!({
                "temp_url": "https://cdn.example.com/files/clip.mp4?token=abc"
            }))
            .unwrap(),
            ..Default::default()
        };
        let attachment = Attachment::new(&cfg, &file).unwrap();
        assert_eq!(
            attachment.url,
            "https://cdn.example.com/files/clip.mp4?token=abc"
        );
        assert_eq!(attachment.path, "/cc/dd/clip.mp4");
        assert_eq!(attachment.kind, MediaKind::Video);
        assert!(!attachment.preview_only);
    }

    #[test]
    fn includes_deferred_attachments_without_paths() {
        use crate::config::PawchiveConfig;

        let cfg = PawchiveConfig::default();
        let post: Post = serde_json::from_value(serde_json::json!({
            "id": "172858951",
            "user": "186745382",
            "service": "patreon",
            "title": "BTS 5th Muster",
            "file": {
                "name": "thumbnail.jpg",
                "path": "/7a/bc/thumbnail.jpg",
                "preview_only": true
            },
            "attachments": [{
                "name": "767687094.mp4",
                "deferred": true,
                "temp_url": "https://t1.pawchive.pw/v/hash/master.m3u8?e=1&s=abc",
                "temp_download_url": "https://t1.pawchive.pw/d/hash/767687094.mp4?e=1&s=xyz",
                "temp_expires": "2026-11-30T00:00:00+00:00"
            }]
        }))
        .unwrap();

        assert_eq!(post.all_files().len(), 2);

        let attachment = Attachment::new(&cfg, post.attachments.first().unwrap()).unwrap();
        assert_eq!(attachment.kind, MediaKind::Video);
        assert_eq!(attachment.name, "767687094.mp4");
        assert_eq!(attachment.path, "/d/hash/767687094.mp4");
        assert_eq!(
            attachment.url,
            "https://t1.pawchive.pw/v/hash/master.m3u8?e=1&s=abc"
        );
        assert_eq!(
            attachment.download_url,
            "https://t1.pawchive.pw/d/hash/767687094.mp4?e=1&s=xyz"
        );
        assert!(!attachment.preview_only);

        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 2);
        assert!(summary.media_kinds.contains(&MediaKind::Video));
    }

    #[test]
    fn counts_deferred_attachments_in_list_summaries() {
        use crate::config::PawchiveConfig;

        let cfg = PawchiveConfig::default();
        // Search/list responses omit the signed URLs; only `deferred` is set.
        let post: Post = serde_json::from_value(serde_json::json!({
            "id": "172858951",
            "user": "186745382",
            "service": "patreon",
            "title": "BTS 5th Muster",
            "file": {
                "name": "thumbnail.jpg",
                "path": "/7a/bc/thumbnail.jpg",
                "preview_only": true
            },
            "attachments": [{
                "name": "767687094.mp4",
                "deferred": true
            }]
        }))
        .unwrap();

        let summary = PostSummary::from_post(&cfg, &post, None);
        assert_eq!(summary.attachment_count, 2);
        assert!(summary.media_kinds.contains(&MediaKind::Video));
        // Without a signed URL the attachment cannot be built for playback.
        assert!(Attachment::new(&cfg, post.attachments.first().unwrap()).is_none());
    }

    #[test]
    fn builds_summaries_and_attachments() {
        let cfg = crate::config::PawchiveConfig::default();
        let post = Post {
            id: "1".into(),
            service: "fanbox".into(),
            user: "2".into(),
            title: "  ".into(),
            content: "<p>Hello <b>world</b></p>".into(),
            file: Some(FileRef {
                name: "cover.png".into(),
                path: "/aa/bb/cover.png".into(),
                ..Default::default()
            }),
            attachments: vec![FileRef {
                name: "clip.mp4".into(),
                path: "/cc/dd/clip.mp4".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let summary = PostSummary::from_post(&cfg, &post, Some("Artist".into()));
        assert_eq!(summary.title, "Untitled post");
        assert_eq!(summary.attachment_count, 2);
        assert_eq!(summary.excerpt, "Hello world");
        assert!(summary
            .thumbnail_url
            .unwrap()
            .contains("/thumbnail/data/aa/bb"));
        assert!(summary.media_kinds.contains(&MediaKind::Video));

        let attachment = Attachment::new(&cfg, post.attachments.first().unwrap()).unwrap();
        assert_eq!(attachment.kind, MediaKind::Video);
        assert_eq!(
            attachment.url,
            "https://file.pawchive.pw/data/cc/dd/clip.mp4"
        );
        assert!(attachment.thumbnail_url.is_none());
    }
}
