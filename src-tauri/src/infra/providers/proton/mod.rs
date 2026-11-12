//! Proton Drive public-link support.
//!
//! Proton public links are end-to-end encrypted: the URL fragment holds the
//! share password, and a visitor needs an anonymous SRP session before the
//! ordinary Drive endpoints will serve the shared subtree. We deliberately use
//! the Rust SDK for that handshake and for range reads instead of duplicating
//! Proton's crypto.
//!
//! A link addresses the share root:
//! `https://drive.proton.me/urls/<token>#<password>`.
//! Files discovered inside a shared folder get one extra query parameter so
//! they keep the same share URL and password:
//! `https://drive.proton.me/urls/<token>?pawchive_node=<volume>~<link>#<password>`.
//! The SDK only understands the share root, so [`parse_link`] strips our query
//! parameter before handing the URL to it.

mod stream;

pub use stream::{download_to_path, ProtonStream};

use crate::infra::provider_passwords::ProviderPasswords;
use crate::shared::error::{AppError, AppResult};
use crate::shared::media_kind::{file_extension, media_kind_for, MediaKind};
use crate::shared::security::safe_filename;
use proton_drive_rs::proton_sdk::config::ProtonClientConfiguration;
use proton_drive_rs::proton_sdk::error::ProtonError;
use proton_drive_rs::proton_sdk::ids::{LinkId, NodeUid, VolumeId};
use proton_drive_rs::{Node, NodeKind, ProtonDrivePublicLinkClient, RevisionReader};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;

const CLIENT_TTL: Duration = Duration::from_secs(30 * 60);
const FILE_TTL: Duration = Duration::from_secs(10 * 60);
const FOLDER_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_FOLDER_DEPTH: usize = 8;
const MAX_FOLDER_FILES: usize = 1_000;

/// A parsed Proton Drive public link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtonLink {
    /// URL the SDK can open: share root plus the URL password fragment.
    pub share_url: String,
    pub token: String,
    pub password: String,
    /// Set when the link points inside a folder rather than at the share root.
    pub node_uid: Option<NodeUid>,
}

impl ProtonLink {
    /// Rebuild a URL for a file (or subfolder) inside this share.
    pub fn url_for(&self, node: Option<&NodeUid>) -> String {
        let mut url = format!("https://drive.proton.me/urls/{}", self.token);
        if let Some(uid) = node {
            url.push_str(&format!("?pawchive_node={uid}"));
        }
        url.push('#');
        url.push_str(&self.password);
        url
    }
}

/// A resolved file inside a Proton Drive share.
#[derive(Clone)]
pub struct ProtonFile {
    pub link: ProtonLink,
    pub client: ProtonDrivePublicLinkClient,
    pub uid: NodeUid,
    pub name: String,
    pub size: u64,
    pub kind: MediaKind,
    /// Proton's declared MIME type, used when the filename has no useful
    /// extension.
    pub content_type: Option<String>,
    reader: Arc<OnceCell<Arc<RevisionReader>>>,
}

impl ProtonFile {
    pub fn url(&self) -> String {
        self.link.url_for(Some(&self.uid))
    }

    /// Open the active revision once and share it across range reads.
    pub async fn reader(&self) -> AppResult<Arc<RevisionReader>> {
        let file = self;
        let reader = self
            .reader
            .get_or_try_init(|| async {
                file.client
                    .open_revision(&file.uid)
                    .await
                    .map(Arc::new)
                    .map_err(map_error)
            })
            .await?;
        Ok(reader.clone())
    }
}

/// What a Proton link turned out to be.
pub enum ProtonExpansion {
    File(Box<ProtonFile>),
    Folder(Vec<ProtonFile>),
}

#[derive(Debug, Clone)]
struct Timed<T> {
    value: T,
    at: Instant,
}

impl<T> Timed<T> {
    fn fresh(&self, ttl: Duration) -> bool {
        self.at.elapsed() < ttl
    }
}

/// Drop expired entries before inserting so browsing many Proton posts cannot
/// grow the resolver maps forever.
fn prune<T>(cache: &mut HashMap<String, Timed<T>>, ttl: Duration, max: usize) {
    cache.retain(|_, entry| entry.fresh(ttl));
    while cache.len() > max {
        let Some(key) = cache.keys().next().cloned() else {
            break;
        };
        cache.remove(&key);
    }
}

/// Shared resolver and short-lived cache for Proton public links.
pub struct ProtonResolver {
    config: ProtonClientConfiguration,
    clients: Mutex<HashMap<String, Timed<ProtonDrivePublicLinkClient>>>,
    files: Mutex<HashMap<String, Timed<ProtonFile>>>,
    folders: Mutex<HashMap<String, Timed<Vec<ProtonFile>>>>,
    passwords: Arc<ProviderPasswords>,
}

impl ProtonResolver {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_passwords(Arc::new(ProviderPasswords::in_memory()))
    }

    pub fn with_passwords(passwords: Arc<ProviderPasswords>) -> Self {
        let app_version = format!(
            "external-drive-pawchive@{}-stable",
            env!("CARGO_PKG_VERSION")
        );
        let config = ProtonClientConfiguration::new(app_version)
            .with_user_agent(format!("Pawchive/{}", env!("CARGO_PKG_VERSION")));
        Self {
            config,
            clients: Mutex::new(HashMap::new()),
            files: Mutex::new(HashMap::new()),
            folders: Mutex::new(HashMap::new()),
            passwords,
        }
    }

    /// Resolve a file link to metadata the player, downloader and transcoder
    /// can use. Folder links are handled by [`Self::expand`].
    pub async fn resolve(&self, raw: &str) -> AppResult<ProtonFile> {
        let link = parse_link(raw)
            .ok_or_else(|| AppError::Validation("not a Proton Drive public link".into()))?;
        let key = self.cache_key(&link, &link.url_for(link.node_uid.as_ref()));
        if let Some(file) = self.cached_file(&key) {
            return Ok(file);
        }

        let client = self.client_for(&link).await?;
        let (uid, node) = self.open_node(&link, &client).await?;
        if node.is_folder() {
            return Err(AppError::Validation(
                "this Proton Drive link is a folder; open the post to list its files".into(),
            ));
        }
        let file = self.file_from_node(&link, &client, uid, node).await?;
        let child_key = self.cache_key(&link, &file.url());
        self.cache_file(key.clone(), file.clone());
        if child_key != key {
            self.cache_file(child_key, file.clone());
        }
        Ok(file)
    }

    /// Inspect a link. A file keeps its metadata; a folder is enumerated into
    /// its individual files so the post view can queue and download each one.
    pub async fn expand(&self, link: &ProtonLink) -> AppResult<ProtonExpansion> {
        let key = self.cache_key(link, &link.url_for(link.node_uid.as_ref()));
        if let Some(files) = self.cached_folder(&key) {
            return Ok(ProtonExpansion::Folder(files));
        }
        if let Some(file) = self.cached_file(&key) {
            return Ok(ProtonExpansion::File(Box::new(file)));
        }
        let client = self.client_for(link).await?;
        let (uid, node) = self.open_node(link, &client).await?;
        if node.is_folder() {
            let files = self.walk_folder(link, &client, &uid).await?;
            self.cache_folder(key, files.clone());
            return Ok(ProtonExpansion::Folder(files));
        }
        let file = self.file_from_node(link, &client, uid, node).await?;
        let child_key = self.cache_key(link, &file.url());
        self.cache_file(key.clone(), file.clone());
        if child_key != key {
            self.cache_file(child_key, file.clone());
        }
        Ok(ProtonExpansion::File(Box::new(file)))
    }

    /// Read a byte range, used for image-dimension probing.
    pub async fn read_range(
        &self,
        file: &ProtonFile,
        offset: u64,
        length: u64,
    ) -> AppResult<Vec<u8>> {
        file.reader()
            .await?
            .read_at(offset, length)
            .await
            .map_err(map_error)
    }

    async fn client_for(&self, link: &ProtonLink) -> AppResult<ProtonDrivePublicLinkClient> {
        #[cfg(target_os = "android")]
        init_android_tls().map_err(|message| {
            AppError::Unavailable(format!(
                "Proton Drive cannot verify TLS on this Android build: {message}"
            ))
        })?;

        // Check the link before opening it so a custom-password share gets a
        // clear message instead of an opaque SRP handshake failure.
        let info = ProtonDrivePublicLinkClient::info(self.config.clone(), &link.share_url)
            .await
            .map_err(map_error)?;
        if info.is_legacy {
            return Err(AppError::Validation(
                "legacy Proton Drive links are not supported".into(),
            ));
        }
        if info.vendor_type != 0 {
            return Err(AppError::Validation(
                "Proton Docs and Sheets links are not supported here; only Proton Drive shares can be played"
                    .into(),
            ));
        }
        let custom_password = if info.is_custom_password_protected {
            let key = password_key(&link.share_url)
                .ok_or_else(|| AppError::Validation("invalid Proton Drive public link".into()))?;
            Some(
                self.passwords
                    .get(&key)
                    .ok_or_else(|| AppError::PasswordRequired {
                        provider: "Proton Drive",
                        url: link.share_url.clone(),
                        rejected: false,
                    })?,
            )
        } else {
            None
        };
        let cache_key = self.client_cache_key(link, custom_password.as_deref());
        if let Some(client) = self.cached_client(&cache_key) {
            return Ok(client);
        }

        let client = match ProtonDrivePublicLinkClient::open(
            self.config.clone(),
            &link.share_url,
            custom_password.as_deref(),
        )
        .await
        {
            Ok(client) => client,
            Err(error) if custom_password.is_some() && is_password_error(&error) => {
                if let Some(key) = password_key(&link.share_url) {
                    self.passwords.remove(&key);
                }
                return Err(AppError::PasswordRequired {
                    provider: "Proton Drive",
                    url: link.share_url.clone(),
                    rejected: true,
                });
            }
            Err(error) => return Err(map_error(error)),
        };
        if let Ok(mut cache) = self.clients.lock() {
            prune(&mut cache, CLIENT_TTL, 32);
            cache.insert(
                cache_key,
                Timed {
                    value: client.clone(),
                    at: Instant::now(),
                },
            );
        }
        Ok(client)
    }

    /// Validate a share password without fetching file metadata.
    pub async fn unlock(&self, raw: &str) -> AppResult<()> {
        let link = parse_link(raw)
            .ok_or_else(|| AppError::Validation("not a Proton Drive public link".into()))?;
        let _ = self.client_for(&link).await?;
        Ok(())
    }

    fn client_cache_key(&self, link: &ProtonLink, password: Option<&str>) -> String {
        let mut hasher = Sha256::new();
        if let Some(password) = password {
            hasher.update(password.as_bytes());
        }
        format!("{}\u{0}{:x}", link.share_url, hasher.finalize())
    }

    fn password_tag(&self, link: &ProtonLink) -> String {
        let Some(key) = password_key(&link.share_url) else {
            return String::new();
        };
        let Some(password) = self.passwords.get(&key) else {
            return String::new();
        };
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn cache_key(&self, link: &ProtonLink, url: &str) -> String {
        format!("{url}\u{0}{}", self.password_tag(link))
    }

    async fn open_node(
        &self,
        link: &ProtonLink,
        client: &ProtonDrivePublicLinkClient,
    ) -> AppResult<(NodeUid, Node)> {
        match &link.node_uid {
            Some(uid) => {
                let node = client
                    .get_node(uid)
                    .await
                    .map_err(map_error)?
                    .ok_or_else(|| {
                        AppError::Unavailable(
                            "the Proton Drive file no longer exists in this share".into(),
                        )
                    })?;
                Ok((uid.clone(), node))
            }
            None => {
                let node = client.get_root_node().await.map_err(map_error)?;
                Ok((node.uid.clone(), node))
            }
        }
    }

    async fn file_from_node(
        &self,
        link: &ProtonLink,
        client: &ProtonDrivePublicLinkClient,
        uid: NodeUid,
        node: Node,
    ) -> AppResult<ProtonFile> {
        let (claimed_size, media_type) = match &node.kind {
            NodeKind::File {
                claimed_size,
                media_type,
                ..
            } => (
                *claimed_size,
                media_type
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase(),
            ),
            NodeKind::Folder => {
                return Err(AppError::Validation(
                    "a Proton Drive folder cannot be played as a file".into(),
                ))
            }
        };
        let content_type = (!media_type.is_empty() && media_type != "application/octet-stream")
            .then_some(media_type);
        let size = match claimed_size.filter(|size| *size > 0) {
            Some(size) => size as u64,
            // Older or partially encrypted revisions may omit the extended
            // attributes. The revision reader still knows the plaintext size,
            // so pay for one extra lookup rather than reading ranges against a
            // zero-byte file.
            None => client.open_revision(&uid).await.map_err(map_error)?.size(),
        };
        let name = safe_filename(&node.name);
        let mut kind = media_kind_for(&name);
        if kind == MediaKind::Other && file_extension(&name).is_empty() {
            // Proton shares usually contain media. A name without an extension
            // is not enough to call it a document, and treating it as video
            // keeps it in the player queue until the codec can be inspected.
            kind = MediaKind::Video;
        }
        let mut file_link = link.clone();
        file_link.node_uid = Some(uid.clone());
        Ok(ProtonFile {
            link: file_link,
            client: client.clone(),
            uid,
            name,
            size,
            kind,
            content_type,
            reader: Arc::new(OnceCell::new()),
        })
    }

    async fn walk_folder(
        &self,
        link: &ProtonLink,
        client: &ProtonDrivePublicLinkClient,
        root_uid: &NodeUid,
    ) -> AppResult<Vec<ProtonFile>> {
        let mut pending = vec![(root_uid.clone(), 0usize)];
        let mut files = Vec::new();
        'walk: while let Some((folder_uid, depth)) = pending.pop() {
            let child_uids = client
                .enumerate_folder_children_node_uids(&folder_uid)
                .await
                .map_err(map_error)?;
            let nodes = client
                .enumerate_nodes(&child_uids)
                .await
                .map_err(map_error)?;
            for node in nodes {
                if node.is_folder() {
                    if depth < MAX_FOLDER_DEPTH {
                        pending.push((node.uid.clone(), depth + 1));
                    }
                    continue;
                }
                if files.len() >= MAX_FOLDER_FILES {
                    break 'walk;
                }
                let uid = node.uid.clone();
                if let Ok(file) = self.file_from_node(link, client, uid, node).await {
                    self.cache_file(self.cache_key(link, &file.url()), file.clone());
                    files.push(file);
                }
            }
        }
        Ok(files)
    }

    fn cached_client(&self, key: &str) -> Option<ProtonDrivePublicLinkClient> {
        let cache = self.clients.lock().ok()?;
        cache
            .get(key)
            .filter(|entry| entry.fresh(CLIENT_TTL))
            .map(|entry| entry.value.clone())
    }

    fn cache_file(&self, key: String, file: ProtonFile) {
        if let Ok(mut cache) = self.files.lock() {
            prune(&mut cache, FILE_TTL, 4_096);
            cache.insert(
                key,
                Timed {
                    value: file,
                    at: Instant::now(),
                },
            );
        }
    }

    fn cached_file(&self, key: &str) -> Option<ProtonFile> {
        let cache = self.files.lock().ok()?;
        cache
            .get(key)
            .filter(|entry| entry.fresh(FILE_TTL))
            .map(|entry| entry.value.clone())
    }

    fn cache_folder(&self, key: String, files: Vec<ProtonFile>) {
        if let Ok(mut cache) = self.folders.lock() {
            prune(&mut cache, FOLDER_TTL, 32);
            cache.insert(
                key,
                Timed {
                    value: files,
                    at: Instant::now(),
                },
            );
        }
    }

    fn cached_folder(&self, key: &str) -> Option<Vec<ProtonFile>> {
        let cache = self.folders.lock().ok()?;
        cache
            .get(key)
            .filter(|entry| entry.fresh(FOLDER_TTL))
            .map(|entry| entry.value.clone())
    }
}

impl Default for ProtonResolver {
    fn default() -> Self {
        Self::with_passwords(Arc::new(ProviderPasswords::in_memory()))
    }
}

/// Parse the public link forms this client understands.
pub fn parse_link(raw: &str) -> Option<ProtonLink> {
    // Called for every attachment during post classification, so avoid URL
    // parsing unless the host is actually present.
    if !contains_ignore_ascii_case(raw, b"drive.proton.me") {
        return None;
    }
    let normalized = normalize(raw)?;
    let url = url::Url::parse(&normalized).ok()?;
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if !matches!(host.as_str(), "drive.proton.me" | "www.drive.proton.me") {
        return None;
    }
    let segments: Vec<&str> = url
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() != 2 || !segments[0].eq_ignore_ascii_case("urls") {
        return None;
    }
    let token = segments[1];
    if !valid_proton_id(token) {
        return None;
    }
    let password = url.fragment()?.to_string();
    if password.is_empty() {
        return None;
    }

    let mut node_uid = None;
    for (name, value) in url.query_pairs() {
        if name == "pawchive_node" {
            node_uid = Some(parse_node_uid(&value)?);
        }
    }

    let share_url = format!("https://drive.proton.me/urls/{token}#{password}");
    Some(ProtonLink {
        share_url,
        token: token.to_string(),
        password,
        node_uid,
    })
}

/// True for any URL this module can resolve.
pub fn is_media_url(raw: &str) -> bool {
    parse_link(raw).is_some()
}

/// Password-store key for a Proton share. The custom password is per share, so
/// the token is the stable identity even if the URL password changes.
pub fn password_key(raw: &str) -> Option<String> {
    parse_link(raw).map(|link| format!("proton:{}", link.token))
}

/// True for every `drive.proton.me` URL, including malformed or
/// password-protected ones. Resolution paths use this so a bad Proton link
/// reports a Proton-specific error instead of falling through to the generic
/// remote resolver.
pub fn is_proton_url(raw: &str) -> bool {
    contains_ignore_ascii_case(raw, b"drive.proton.me")
        && matches!(
            crate::infra::providers::provider_for_url(raw),
            crate::infra::providers::MediaProvider::Proton
        )
}

fn normalize(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_end_matches(['.', ',', ';', ':', ')', ']', '}']);
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if trimmed.starts_with("https://") {
        trimmed.to_string()
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

fn parse_node_uid(raw: &str) -> Option<NodeUid> {
    let (volume, link) = raw.split_once('~')?;
    if !valid_proton_id(volume) || !valid_proton_id(link) {
        return None;
    }
    Some(NodeUid::new(VolumeId::new(volume), LinkId::new(link)))
}

fn contains_ignore_ascii_case(haystack: &str, needle: &[u8]) -> bool {
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}

/// reqwest 0.13 uses rustls-platform-verifier on Android, which must be
/// initialized with the application context before its first TLS handshake.
/// Tauri/Tao publishes that context through `ndk-context`.
#[cfg(target_os = "android")]
fn init_android_tls() -> Result<(), String> {
    use std::sync::OnceLock;
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| {
        let context =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(ndk_context::android_context))
                .map_err(|_| "the Android runtime context is not ready".to_string())?;
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|error| format!("could not access the Android JVM: {error:?}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("could not attach to the Android JVM: {error:?}"))?;
        let raw_context: jni::sys::jobject = context.context().cast();
        let context = unsafe { jni::objects::JObject::from_raw(raw_context) };
        rustls_platform_verifier::android::init_hosted(&mut env, context).map_err(|error| {
            format!("could not initialize the Android certificate verifier: {error:?}")
        })
    })
    .clone()
}

fn valid_proton_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '='))
}

fn is_password_error(error: &ProtonError) -> bool {
    matches!(error, ProtonError::Api(api) if matches!(api.http_status, 400 | 401 | 403 | 422))
}

pub(crate) fn map_error(error: ProtonError) -> AppError {
    match &error {
        ProtonError::Api(api) if api.http_status == 404 => AppError::NotFound,
        ProtonError::Api(api) if api.is_unauthorized() => AppError::Unavailable(
            "Proton Drive rejected this share link; it may have expired or need a password".into(),
        ),
        ProtonError::Transport(transport) => {
            // Do not format the transport error: reqwest includes the request
            // URL, and a Proton URL fragment is the share password.
            let message = if transport.is_timeout() {
                "Proton Drive request timed out"
            } else if transport.is_connect() {
                "could not connect to Proton Drive"
            } else if transport.is_body() {
                "the Proton Drive response was interrupted"
            } else {
                "the Proton Drive request failed"
            };
            AppError::Network(message.into())
        }
        _ => AppError::Unavailable(format!("Proton Drive: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_share_and_child_links() {
        let share = parse_link("https://drive.proton.me/urls/AbC_123#correct-horse").unwrap();
        assert_eq!(share.token, "AbC_123");
        assert_eq!(share.password, "correct-horse");
        assert_eq!(share.node_uid, None);
        assert_eq!(
            share.share_url,
            "https://drive.proton.me/urls/AbC_123#correct-horse"
        );

        let child = parse_link(
            "https://drive.proton.me/urls/AbC_123?pawchive_node=vol-1~link_2#correct-horse",
        )
        .unwrap();
        assert_eq!(child.token, "AbC_123");
        assert_eq!(
            child.node_uid.as_ref().map(ToString::to_string).as_deref(),
            Some("vol-1~link_2")
        );
        assert_eq!(
            child.url_for(child.node_uid.as_ref()),
            "https://drive.proton.me/urls/AbC_123?pawchive_node=vol-1~link_2#correct-horse"
        );
    }

    #[test]
    fn accepts_scheme_less_and_trailing_slashes() {
        let link = parse_link("drive.proton.me/urls/token123/#password").unwrap();
        assert_eq!(link.token, "token123");
        let link = parse_link("http://drive.proton.me/urls/token123#password").unwrap();
        assert_eq!(link.token, "token123");
    }

    #[test]
    fn rejects_other_hosts_and_missing_fragments() {
        assert!(parse_link("https://drive.proton.me/urls/token123").is_none());
        assert!(parse_link("https://proton.me/urls/token123#password").is_none());
        assert!(parse_link("https://drive.proton.me/file/token123#password").is_none());
        assert!(parse_link("https://example.com/urls/token123#password").is_none());
    }

    #[test]
    fn rejects_malformed_child_ids() {
        assert!(
            parse_link("https://drive.proton.me/urls/token123?pawchive_node=vol#password")
                .is_none()
        );
        assert!(
            parse_link("https://drive.proton.me/urls/token123?pawchive_node=vol~#password")
                .is_none()
        );
        assert!(
            parse_link("https://drive.proton.me/urls/token123?pawchive_node=~link#password")
                .is_none()
        );
    }

    #[test]
    fn classifies_proton_links() {
        assert!(is_media_url(
            "https://drive.proton.me/urls/token123#password"
        ));
        assert!(is_proton_url("https://drive.proton.me/urls/token123"));
        assert!(is_proton_url("https://drive.proton.me/"));
        assert!(!is_media_url("https://drive.google.com/file/d/abc/view"));
        assert!(!is_proton_url("https://drive.google.com/file/d/abc/view"));
    }
}
