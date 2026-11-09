use super::common::{
    bool_or_default, flex_ts, i64_or_default, string_or_default, strip_html, truncate, vec_or_empty,
};
use super::creator::CreatorSummary;
use crate::shared::media_kind::{file_extension, media_kind_for, MediaKind};
use crate::shared::security::safe_filename;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

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

    /// A source that can actually be played or downloaded now. The deferred
    /// marker alone is not enough: over-limit files carry `deferred` without a
    /// path or signed URL, and those are not real media.
    pub fn has_real_source(&self) -> bool {
        !self.path.trim().is_empty()
            || self.temp_url().is_some()
            || self.temp_download_url().is_some()
    }
}

/// The archive occasionally gives a cover image a video-looking `name`.
/// Prefer the actual path extension when it is a recognised media type.
pub fn media_kind_for_file(file: &FileRef) -> MediaKind {
    if crate::infra::providers::mega::is_media_url(&file.path) {
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
        for raw in crate::infra::providers::direct::extract(&text) {
            let parsed = match url::Url::parse(&raw) {
                Ok(url) => url,
                Err(_) => continue,
            };
            let path = parsed.path().trim_matches('/');
            if existing_paths.contains(path) {
                continue;
            }
            let name = if let Some(link) = crate::infra::providers::mega::parse_file_link(&raw) {
                // `get_post` replaces this placeholder with the real filename
                // from the encrypted MEGA attributes.
                safe_filename(&format!("mega-{}", link.handle))
            } else if let Some(link) = crate::infra::providers::mega::parse_folder_link(&raw) {
                safe_filename(&format!("mega-folder-{}", link.handle))
            } else if let Some(id) = crate::infra::providers::remote::drive_file_id(&raw) {
                safe_filename(&format!("drive-{id}"))
            } else if let Some(id) = crate::infra::providers::remote::drive_folder_id(&raw) {
                safe_filename(&format!("drive-folder-{id}"))
            } else if let Some(id) = crate::infra::providers::remote::gofile_content_id(&raw) {
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
                && file.has_real_source()
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
    pub provider: crate::infra::providers::MediaProvider,
    pub ext: String,
    pub preview_only: bool,
}

impl Attachment {
    pub fn new(cfg: &crate::shared::config::PawchiveConfig, file: &FileRef) -> Option<Self> {
        let temp_url = file
            .temp_url()
            .and_then(|raw| crate::shared::security::validate_media_remote_url(raw).ok())
            .map(|url| url.to_string());
        let temp_download_url = file
            .temp_download_url()
            .and_then(|raw| crate::shared::security::validate_media_remote_url(raw).ok())
            .map(|url| url.to_string());
        let has_path = !file.path.trim().is_empty();
        let (path, fallback_url) = if has_path {
            if file.path.starts_with("https://") {
                let url = crate::shared::security::validate_media_remote_url(&file.path).ok()?;
                (url.to_string(), url.to_string())
            } else {
                let path = crate::shared::security::validate_relative_path(&file.path).ok()?;
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
        let provider = crate::infra::providers::provider_for_url(&url);
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
        cfg: &crate::shared::config::PawchiveConfig,
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
