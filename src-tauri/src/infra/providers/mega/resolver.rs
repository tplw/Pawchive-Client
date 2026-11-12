use super::crypto::{
    decode_base64_url, decrypt_attributes, decrypt_key_blocks, derive_keys, folder_key_from_bytes,
};
use super::links::{
    parse_file_link, parse_folder_file_link, MegaFile, MegaFolderFile, MegaFolderLink, MegaLink,
};
use super::password::{decrypt_protected_link, is_protected_link, password_key, PasswordLinkError};
use crate::infra::provider_passwords::ProviderPasswords;
use crate::shared::error::{AppError, AppResult};
use crate::shared::security::{safe_filename, validate_media_remote_url};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const API_URL: &str = "https://g.api.mega.co.nz/cs";
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const DECRYPTED_TTL: Duration = Duration::from_secs(10 * 60);
const API_TIMEOUT: Duration = Duration::from_secs(20);
static NEXT_SEQUENCE: AtomicI64 = AtomicI64::new(1);

fn mega_api_error(code: i64) -> AppError {
    match code {
        -9 => AppError::NotFound,
        -3 => AppError::Unavailable("MEGA is busy; try again shortly".into()),
        -11 | -16 | -18 => AppError::Unavailable(format!("MEGA rejected this file (error {code})")),
        _ => AppError::Unavailable(format!("MEGA could not provide this file (error {code})")),
    }
}

fn parse_file_item(item: Value, link_key: &[u8], fallback: &str) -> AppResult<MegaFile> {
    let (key, nonce) = derive_keys(link_key)
        .ok_or_else(|| AppError::Validation("MEGA link key is invalid".into()))?;
    let size = item
        .get("s")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::InvalidResponse("MEGA response has no file size".into()))?;
    let attributes = item
        .get("at")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::InvalidResponse("MEGA response has no attributes".into()))?;
    let download = item
        .get("g")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Unavailable("MEGA did not return a download link".into()))?;
    // The CDN currently advertises plain HTTP even though the same host
    // accepts HTTPS. The client is HTTPS-only, so upgrade the scheme.
    let download = match download.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => download.to_string(),
    };
    let download_url = validate_media_remote_url(&download)
        .map_err(|_| AppError::UnsafeUrl("MEGA returned an unsafe download URL".into()))?
        .to_string();
    let encrypted = decode_base64_url(attributes)
        .ok_or_else(|| AppError::InvalidResponse("MEGA attributes are not valid base64".into()))?;
    let attributes = decrypt_attributes(&encrypted, &key)
        .ok_or_else(|| AppError::Unavailable("could not decrypt MEGA file metadata".into()))?;
    let name = attributes
        .get("n")
        .and_then(Value::as_str)
        .map(safe_filename)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("mega-{fallback}"));
    Ok(MegaFile {
        name,
        size,
        download_url,
        key,
        nonce,
    })
}

pub(super) async fn fetch_file(client: &reqwest::Client, link: &MegaLink) -> AppResult<MegaFile> {
    let link_key = decode_base64_url(&link.key)
        .ok_or_else(|| AppError::Validation("MEGA link key is invalid".into()))?;

    let mut last_error = AppError::Unavailable("MEGA did not return a download link".into());
    for attempt in 0..3 {
        let sequence = NEXT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let request = client
            .post(API_URL)
            .query(&[("id", sequence.to_string())])
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .timeout(API_TIMEOUT)
            .body(json!([{ "a": "g", "g": 1, "p": link.handle }]).to_string());
        let response = request.send().await.map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "MEGA metadata request answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let value: Value = response.json().await.map_err(|error| {
            AppError::InvalidResponse(format!("invalid MEGA response: {error}"))
        })?;
        let item = match value {
            Value::Array(mut items) => items.drain(..).next().unwrap_or(Value::Null),
            other => other,
        };
        if let Some(code) = item.as_i64() {
            let error = mega_api_error(code);
            if code == -3 && attempt < 2 {
                last_error = error;
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            return Err(error);
        }
        return parse_file_item(item, &link_key, &link.handle);
    }
    Err(last_error)
}

/// Download metadata for a file that lives inside a shared folder. MEGA
/// requires the original folder link handle as `n` in the query string and the
/// file handle as `n` in the request body.
async fn fetch_folder_file(
    client: &reqwest::Client,
    folder_handle: &str,
    file_handle: &str,
    link_key: &[u8],
) -> AppResult<MegaFile> {
    let mut last_error = AppError::Unavailable("MEGA did not return a download link".into());
    for attempt in 0..3 {
        let sequence = NEXT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let request = client
            .post(API_URL)
            .query(&[
                ("id", sequence.to_string()),
                ("n", folder_handle.to_string()),
            ])
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .timeout(API_TIMEOUT)
            .body(json!([{ "a": "g", "g": 1, "ssl": 0, "n": file_handle }]).to_string());
        let response = request.send().await.map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "MEGA folder file request answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let value: Value = response.json().await.map_err(|error| {
            AppError::InvalidResponse(format!("invalid MEGA folder response: {error}"))
        })?;
        let item = match value {
            Value::Array(mut items) => items.drain(..).next().unwrap_or(Value::Null),
            other => other,
        };
        if let Some(code) = item.as_i64() {
            let error = mega_api_error(code);
            if code == -3 && attempt < 2 {
                last_error = error;
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            return Err(error);
        }
        return parse_file_item(item, link_key, file_handle);
    }
    Err(last_error)
}

#[derive(Clone)]
struct CachedFile {
    file: MegaFile,
    fetched_at: Instant,
}

#[derive(Clone)]
struct CachedFolder {
    files: Vec<MegaFolderFile>,
    fetched_at: Instant,
}

/// Resolves MEGA links and keeps recent results so opening a post, reading its
/// metadata and starting playback only hit the MEGA API once.
#[derive(Clone)]
pub struct MegaResolver {
    client: reqwest::Client,
    cache: Arc<Mutex<HashMap<String, CachedFile>>>,
    folders: Arc<Mutex<HashMap<String, CachedFolder>>>,
    passwords: Arc<ProviderPasswords>,
    decrypted: Arc<Mutex<HashMap<String, (String, Instant)>>>,
}

impl MegaResolver {
    #[cfg(test)]
    pub fn new(client: reqwest::Client) -> Self {
        Self::with_passwords(client, Arc::new(ProviderPasswords::in_memory()))
    }

    pub fn with_passwords(client: reqwest::Client, passwords: Arc<ProviderPasswords>) -> Self {
        Self {
            client,
            cache: Arc::new(Mutex::new(HashMap::new())),
            folders: Arc::new(Mutex::new(HashMap::new())),
            passwords,
            decrypted: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub fn client_clone(&self) -> reqwest::Client {
        self.client.clone()
    }

    fn cache_key(link: &MegaLink) -> String {
        format!("{}!{}", link.handle, link.key)
    }

    fn cached(&self, key: &str) -> Option<MegaFile> {
        let cache = self.cache.lock().ok()?;
        let entry = cache.get(key)?;
        if entry.fetched_at.elapsed() < CACHE_TTL {
            Some(entry.file.clone())
        } else {
            None
        }
    }

    fn store(&self, key: String, file: MegaFile) {
        if let Ok(mut cache) = self.cache.lock() {
            // Keep the cache bounded when a long session opens many links.
            if cache.len() >= 128 {
                cache.clear();
            }
            cache.insert(
                key,
                CachedFile {
                    file,
                    fetched_at: Instant::now(),
                },
            );
        }
    }

    fn folder_cache_key(link: &MegaFolderLink) -> String {
        format!("{}!{}", link.handle, link.key)
    }

    fn cached_folder(&self, key: &str) -> Option<Vec<MegaFolderFile>> {
        let cache = self.folders.lock().ok()?;
        let entry = cache.get(key)?;
        if entry.fetched_at.elapsed() < CACHE_TTL {
            Some(entry.files.clone())
        } else {
            None
        }
    }

    fn store_folder(&self, key: String, files: Vec<MegaFolderFile>) {
        if let Ok(mut cache) = self.folders.lock() {
            if cache.len() >= 32 {
                cache.clear();
            }
            cache.insert(
                key,
                CachedFolder {
                    files,
                    fetched_at: Instant::now(),
                },
            );
        }
    }

    /// Decrypt a `#P!` link into the standard link, or return `None` when the
    /// URL is not password protected.
    pub async fn decrypt_link(&self, raw: &str) -> AppResult<Option<String>> {
        if !is_protected_link(raw) {
            return Ok(None);
        }
        let key = password_key(raw)
            .ok_or_else(|| AppError::Validation("invalid MEGA password-protected link".into()))?;
        let password = self
            .passwords
            .get(&key)
            .ok_or_else(|| AppError::PasswordRequired {
                provider: "MEGA",
                url: raw.to_string(),
                rejected: false,
            })?;
        let cache_key = format!("{raw}\u{0}{password}");
        if let Ok(cache) = self.decrypted.lock() {
            if let Some((link, at)) = cache.get(&cache_key) {
                if at.elapsed() < DECRYPTED_TTL {
                    return Ok(Some(link.clone()));
                }
            }
        }

        let raw_owned = raw.to_string();
        let password_owned = password.clone();
        let result = crate::shared::task::blocking(move || {
            Ok(decrypt_protected_link(&raw_owned, &password_owned))
        })
        .await?;
        match result {
            Ok(link) => {
                if let Ok(mut cache) = self.decrypted.lock() {
                    if cache.len() >= 64 {
                        cache.clear();
                    }
                    cache.insert(cache_key, (link.clone(), Instant::now()));
                }
                Ok(Some(link))
            }
            Err(PasswordLinkError::WrongPassword) => {
                self.passwords.remove(&key);
                Err(AppError::PasswordRequired {
                    provider: "MEGA",
                    url: raw.to_string(),
                    rejected: true,
                })
            }
            Err(PasswordLinkError::Invalid) => Err(AppError::Validation(
                "invalid MEGA password-protected link".into(),
            )),
        }
    }

    /// Validate a password-protected link without fetching its metadata.
    pub async fn unlock(&self, raw: &str) -> AppResult<()> {
        let _ = self.decrypt_link(raw).await?;
        Ok(())
    }

    pub async fn resolve(&self, raw: &str) -> AppResult<MegaFile> {
        let decrypted = self.decrypt_link(raw).await?;
        let raw = decrypted.as_deref().unwrap_or(raw);
        if let Some(link) = parse_file_link(raw) {
            let key = Self::cache_key(&link);
            if let Some(file) = self.cached(&key) {
                return Ok(file);
            }
            let file = fetch_file(&self.client, &link).await?;
            self.store(key, file.clone());
            return Ok(file);
        }
        let link = parse_folder_file_link(raw)
            .ok_or_else(|| AppError::Validation("not a MEGA file link".into()))?;
        let key = format!(
            "{}!{}!{}",
            link.folder_handle, link.file_handle, link.folder_key
        );
        if let Some(file) = self.cached(&key) {
            return Ok(file);
        }
        let folder = MegaFolderLink {
            handle: link.folder_handle.clone(),
            key: link.folder_key.clone(),
        };
        let files = self.list_folder(&folder).await?;
        let child = files
            .into_iter()
            .find(|file| file.handle == link.file_handle)
            .ok_or(AppError::NotFound)?;
        let file_key = decode_base64_url(&child.key)
            .ok_or_else(|| AppError::Validation("MEGA file key is invalid".into()))?;
        let file = fetch_folder_file(
            &self.client,
            &link.folder_handle,
            &link.file_handle,
            &file_key,
        )
        .await?;
        self.store(key, file.clone());
        Ok(file)
    }

    /// List the files inside a public MEGA folder, recursively walking any
    /// subfolders. Node keys are encrypted with their parent folder's key.
    pub async fn list_folder(&self, link: &MegaFolderLink) -> AppResult<Vec<MegaFolderFile>> {
        let cache_key = Self::folder_cache_key(link);
        if let Some(files) = self.cached_folder(&cache_key) {
            return Ok(files);
        }
        let root_key = folder_key_from_bytes(
            &decode_base64_url(&link.key)
                .ok_or_else(|| AppError::Validation("MEGA folder key is invalid".into()))?,
        )
        .ok_or_else(|| AppError::Validation("MEGA folder key is invalid".into()))?;

        let sequence = NEXT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let request = self
            .client
            .post(API_URL)
            .query(&[("id", sequence.to_string()), ("n", link.handle.clone())])
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .timeout(API_TIMEOUT)
            .body(json!([{ "a": "f", "c": 1, "r": 1, "ca": 1 }]).to_string());
        let response = request.send().await.map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "MEGA folder request answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let value: Value = response.json().await.map_err(|error| {
            AppError::InvalidResponse(format!("invalid MEGA folder response: {error}"))
        })?;
        let item = match value {
            Value::Array(mut items) => items.drain(..).next().unwrap_or(Value::Null),
            other => other,
        };
        if let Some(code) = item.as_i64() {
            return Err(mega_api_error(code));
        }
        let nodes = item
            .get("f")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::InvalidResponse("MEGA folder response has no nodes".into()))?
            .clone();

        let mut folder_keys: HashMap<String, [u8; 16]> = HashMap::new();
        folder_keys.insert(link.handle.clone(), root_key);
        // The API returns the folder's actual node handle separately from the
        // link handle. Identify root nodes (their parent is not in the reply)
        // and seed them with the key from the URL fragment.
        let handles: HashSet<&str> = nodes
            .iter()
            .filter_map(|node| node.get("h").and_then(Value::as_str))
            .collect();
        for node in &nodes {
            let Some(handle) = node.get("h").and_then(Value::as_str) else {
                continue;
            };
            let parent = node.get("p").and_then(Value::as_str).unwrap_or_default();
            if !handles.contains(parent) {
                folder_keys.insert(handle.to_string(), root_key);
            }
        }
        let mut pending = nodes;
        let mut files = Vec::new();
        loop {
            if pending.is_empty() {
                break;
            }
            let mut next = Vec::new();
            let mut progress = false;
            for node in pending.drain(..) {
                let parent = node
                    .get("p")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let Some(parent_key) = folder_keys.get(&parent).copied() else {
                    next.push(node);
                    continue;
                };
                let Some(handle) = node.get("h").and_then(Value::as_str) else {
                    continue;
                };
                let key_field = node.get("k").and_then(Value::as_str).unwrap_or_default();
                let encrypted_key = key_field
                    .split_once(':')
                    .map(|(_, key)| key)
                    .unwrap_or(key_field);
                let Some(encrypted) = decode_base64_url(encrypted_key) else {
                    continue;
                };
                let Some(key_bytes) = decrypt_key_blocks(&encrypted, &parent_key) else {
                    continue;
                };
                let node_type = node.get("t").and_then(Value::as_i64).unwrap_or(0);
                if node_type == 1 {
                    if let Some(child_key) = folder_key_from_bytes(&key_bytes) {
                        folder_keys.insert(handle.to_string(), child_key);
                    }
                } else if key_bytes.len() == 32 {
                    let name = node
                        .get("a")
                        .and_then(Value::as_str)
                        .and_then(decode_base64_url)
                        .and_then(|attributes| {
                            let (key, _) = derive_keys(&key_bytes)?;
                            decrypt_attributes(&attributes, &key)
                        })
                        .and_then(|attributes| {
                            attributes
                                .get("n")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| format!("mega-{handle}"));
                    files.push(MegaFolderFile {
                        handle: handle.to_string(),
                        key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&key_bytes),
                        name,
                    });
                }
                progress = true;
            }
            if !progress {
                break;
            }
            pending = next;
        }
        self.store_folder(cache_key, files.clone());
        Ok(files)
    }
}
