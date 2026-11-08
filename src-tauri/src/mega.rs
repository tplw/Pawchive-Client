use crate::error::{AppError, AppResult};
use crate::security::{media_kind_for, safe_filename, validate_media_remote_url};
use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit, StreamCipher};
use aes::Aes128;
use base64::Engine;
use ctr::cipher::KeyIvInit;
use ctr::Ctr128BE;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

type AesCtr = Ctr128BE<Aes128>;

const API_URL: &str = "https://g.api.mega.co.nz/cs";
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const API_TIMEOUT: Duration = Duration::from_secs(20);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// A public MEGA file link: the node handle plus the fragment key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MegaLink {
    pub handle: String,
    pub key: String,
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
    pub fn kind(&self) -> crate::models::MediaKind {
        let kind = media_kind_for(&self.name);
        if kind == crate::models::MediaKind::Other {
            crate::models::MediaKind::Video
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

fn decode_base64_url(raw: &str) -> Option<Vec<u8>> {
    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != ',')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let mut padded = cleaned;
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    base64::engine::general_purpose::URL_SAFE
        .decode(padded.as_bytes())
        .ok()
        .or_else(|| {
            base64::engine::general_purpose::STANDARD
                .decode(padded.as_bytes())
                .ok()
        })
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
    } else if let Some(rest) = fragment.strip_prefix('!') {
        let (handle, key) = rest.split_once('!')?;
        (handle.to_string(), key.to_string())
    } else {
        return None;
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

fn derive_keys(link_key: &[u8]) -> Option<([u8; 16], [u8; 8])> {
    if link_key.len() != 32 {
        return None;
    }
    let mut key = [0u8; 16];
    for index in 0..16 {
        key[index] = link_key[index] ^ link_key[index + 16];
    }
    let mut nonce = [0u8; 8];
    nonce.copy_from_slice(&link_key[16..24]);
    Some((key, nonce))
}

/// MEGA attributes are AES-CBC encrypted with a zero IV and padded with NULs.
/// The plaintext starts with the literal `MEGA` followed by JSON.
fn decrypt_attributes(encrypted: &[u8], key: &[u8; 16]) -> Option<Value> {
    if encrypted.is_empty() || encrypted.len() % 16 != 0 {
        return None;
    }
    let cipher = Aes128::new_from_slice(key).ok()?;
    let mut data = encrypted.to_vec();
    let mut previous = [0u8; 16];
    for chunk in data.chunks_exact_mut(16) {
        let current: [u8; 16] = chunk.try_into().ok()?;
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        for index in 0..16 {
            chunk[index] = block[index] ^ previous[index];
        }
        previous = current;
    }
    let end = data
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|index| index + 1)
        .unwrap_or(0);
    let text = std::str::from_utf8(&data[..end]).ok()?;
    let text = text.strip_prefix("MEGA").unwrap_or(text);
    serde_json::from_str(text).ok()
}

fn ctr_cipher(key: &[u8; 16], nonce: &[u8; 8], block_index: u64) -> Option<AesCtr> {
    let mut iv = [0u8; 16];
    iv[..8].copy_from_slice(nonce);
    iv[8..].copy_from_slice(&block_index.to_be_bytes());
    AesCtr::new_from_slices(key, &iv).ok()
}

fn mega_api_error(code: i64) -> AppError {
    match code {
        -9 => AppError::NotFound,
        -3 => AppError::Unavailable("MEGA is busy; try again shortly".into()),
        -11 | -16 | -18 => AppError::Unavailable(format!("MEGA rejected this file (error {code})")),
        _ => AppError::Unavailable(format!("MEGA could not provide this file (error {code})")),
    }
}

async fn fetch_file(client: &reqwest::Client, link: &MegaLink) -> AppResult<MegaFile> {
    let link_key = decode_base64_url(&link.key)
        .ok_or_else(|| AppError::Validation("MEGA link key is invalid".into()))?;
    let (key, nonce) = derive_keys(&link_key)
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
        let response = request
            .send()
            .await
            .map_err(|error| AppError::Network(crate::security::network_error_message(&error)))?;
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
        let encrypted = decode_base64_url(attributes).ok_or_else(|| {
            AppError::InvalidResponse("MEGA attributes are not valid base64".into())
        })?;
        let attributes = decrypt_attributes(&encrypted, &key)
            .ok_or_else(|| AppError::Unavailable("could not decrypt MEGA file metadata".into()))?;
        let name = attributes
            .get("n")
            .and_then(Value::as_str)
            .map(safe_filename)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("mega-{}", link.handle));
        return Ok(MegaFile {
            name,
            size,
            download_url,
            key,
            nonce,
        });
    }
    Err(last_error)
}

static NEXT_SEQUENCE: AtomicI64 = AtomicI64::new(1);

#[derive(Clone)]
struct CachedFile {
    file: MegaFile,
    fetched_at: Instant,
}

/// Resolves MEGA links and keeps recent results so opening a post, reading its
/// metadata and starting playback only hit the MEGA API once.
#[derive(Clone)]
pub struct MegaResolver {
    client: reqwest::Client,
    cache: Arc<Mutex<HashMap<String, CachedFile>>>,
}

impl MegaResolver {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            cache: Arc::new(Mutex::new(HashMap::new())),
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

    pub async fn resolve(&self, raw: &str) -> AppResult<MegaFile> {
        let link = parse_file_link(raw)
            .ok_or_else(|| AppError::Validation("not a MEGA file link".into()))?;
        let key = Self::cache_key(&link);
        if let Some(file) = self.cached(&key) {
            return Ok(file);
        }
        let file = fetch_file(&self.client, &link).await?;
        self.store(key, file.clone());
        Ok(file)
    }
}

/// A registered MEGA source that the loopback media server can stream.
#[derive(Clone)]
pub struct MegaStream {
    pub file: MegaFile,
    pub link: MegaLink,
    pub client: reqwest::Client,
}

impl MegaStream {
    pub fn new(client: reqwest::Client, link: MegaLink, file: MegaFile) -> Self {
        Self { client, link, file }
    }

    pub async fn open(&self, start: u64, end: u64) -> AppResult<MegaReader> {
        match MegaReader::open(&self.client, &self.file, start, end).await {
            Ok(reader) => Ok(reader),
            Err(first_error) => {
                // CDN links expire. Refresh once through the API before
                // failing the playback range request.
                let file = fetch_file(&self.client, &self.link).await?;
                MegaReader::open(&self.client, &file, start, end)
                    .await
                    .map_err(|_| first_error)
            }
        }
    }
}

/// Decrypting reader for a byte range of a MEGA file. AES-CTR is seekable at
/// 16-byte boundaries, so range requests only need the matching block index.
pub struct MegaReader {
    response: reqwest::Response,
    cipher: AesCtr,
    skip: usize,
    remaining: u64,
}

fn content_range_start(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes "))
        .and_then(|value| value.split_once('-').map(|(start, _)| start))
        .and_then(|start| start.trim().parse::<u64>().ok())
}

impl MegaReader {
    pub async fn open(
        client: &reqwest::Client,
        file: &MegaFile,
        start: u64,
        end: u64,
    ) -> AppResult<Self> {
        if file.size == 0 {
            return Err(AppError::Playback("the MEGA file is empty".into()));
        }
        if start >= file.size || end < start {
            return Err(AppError::Playback("invalid MEGA media range".into()));
        }
        let end = end.min(file.size - 1);
        let aligned_start = start - start % 16;
        let response = client
            .get(&file.download_url)
            .header(
                reqwest::header::RANGE,
                format!("bytes={aligned_start}-{end}"),
            )
            .header(reqwest::header::ACCEPT, "*/*")
            .timeout(READ_TIMEOUT)
            .send()
            .await
            .map_err(|error| AppError::Network(crate::security::network_error_message(&error)))?;
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Unavailable(format!(
                "MEGA download answered HTTP {}",
                status.as_u16()
            )));
        }
        let body_start = if status == reqwest::StatusCode::PARTIAL_CONTENT {
            content_range_start(&response).unwrap_or(aligned_start)
        } else {
            0
        };
        if body_start > start || body_start % 16 != 0 {
            return Err(AppError::Unavailable(
                "MEGA returned an unexpected byte range".into(),
            ));
        }
        let cipher = ctr_cipher(&file.key, &file.nonce, body_start / 16)
            .ok_or_else(|| AppError::Internal("could not initialise MEGA decryption".into()))?;
        Ok(Self {
            response,
            cipher,
            skip: (start - body_start) as usize,
            remaining: end - start + 1,
        })
    }

    pub async fn next_chunk(&mut self) -> AppResult<Option<Vec<u8>>> {
        loop {
            if self.remaining == 0 {
                return Ok(None);
            }
            let chunk = tokio::time::timeout(READ_TIMEOUT, self.response.chunk())
                .await
                .map_err(|_| AppError::Timeout)?
                .map_err(|error| {
                    AppError::Network(crate::security::network_error_message(&error))
                })?;
            let Some(chunk) = chunk else {
                return Err(AppError::Unavailable(
                    "the MEGA download ended before the file was complete".into(),
                ));
            };
            if chunk.is_empty() {
                continue;
            }
            let mut chunk = chunk.to_vec();
            self.cipher.apply_keystream(&mut chunk);
            if self.skip > 0 {
                if chunk.len() <= self.skip {
                    self.skip -= chunk.len();
                    continue;
                }
                chunk.drain(..self.skip);
                self.skip = 0;
            }
            if chunk.len() as u64 > self.remaining {
                chunk.truncate(self.remaining as usize);
            }
            self.remaining -= chunk.len() as u64;
            return Ok(Some(chunk));
        }
    }
}

/// Download a MEGA file to disk while decrypting it. Used by the download
/// queue and the transcoder so both behave like any other remote media file.
pub async fn download_to_path<F>(
    resolver: &MegaResolver,
    raw_url: &str,
    path: &Path,
    max_bytes: u64,
    token: Option<&CancellationToken>,
    mut progress: F,
) -> AppResult<(MegaFile, u64)>
where
    F: FnMut(u64, Option<u64>),
{
    let file = resolver.resolve(raw_url).await?;
    if file.size > max_bytes {
        return Err(AppError::Validation(
            "the MEGA file exceeds the size limit".into(),
        ));
    }
    let output = tokio::fs::File::create(path)
        .await
        .map_err(|error| AppError::Io(format!("could not create MEGA download file: {error}")))?;
    let mut output = BufWriter::with_capacity(1024 * 1024, output);
    progress(0, Some(file.size));
    if file.size == 0 {
        output
            .flush()
            .await
            .map_err(|error| AppError::Io(format!("could not flush MEGA download: {error}")))?;
        return Ok((file, 0));
    }
    let mut reader = MegaReader::open(resolver.client(), &file, 0, file.size - 1).await?;
    let mut downloaded = 0u64;
    loop {
        let next = if let Some(token) = token {
            tokio::select! {
                _ = token.cancelled() => return Err(AppError::Cancelled),
                next = reader.next_chunk() => next?,
            }
        } else {
            reader.next_chunk().await?
        };
        let Some(chunk) = next else {
            break;
        };
        downloaded += chunk.len() as u64;
        if downloaded > max_bytes {
            return Err(AppError::Validation(
                "the MEGA file exceeds the size limit".into(),
            ));
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|error| AppError::Io(format!("could not write MEGA download: {error}")))?;
        progress(downloaded, Some(file.size));
    }
    output
        .flush()
        .await
        .map_err(|error| AppError::Io(format!("could not flush MEGA download: {error}")))?;
    Ok((file, downloaded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_current_and_legacy_links() {
        let current = parse_file_link(
            "https://mega.nz/file/cH51DYDR#qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30",
        )
        .unwrap();
        assert_eq!(current.handle, "cH51DYDR");
        assert_eq!(current.key, "qH7QOfRcM-7N9riZWdSjsRq5VDTLfIhThx1capgVA30");

        let legacy = parse_file_link(
            "https://mega.nz/#!Ue5VRSIQ!kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k",
        )
        .unwrap();
        assert_eq!(legacy.handle, "Ue5VRSIQ");
        assert_eq!(legacy.key, "kC2E4a4JwfWWCWYNJovGFHlbz8FN-ISsBAGPzvTjT6k");

        assert!(parse_file_link("https://mega.nz/folder/abc#def").is_none());
        assert!(parse_file_link("https://example.com/file/cH51DYDR#key").is_none());
    }

    #[test]
    fn derives_the_content_key_and_nonce() {
        let link_key = decode_base64_url("ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8").unwrap();
        let (key, nonce) = derive_keys(&link_key).unwrap();
        assert_eq!(key, [16u8; 16]);
        assert_eq!(nonce, [48, 49, 50, 51, 52, 53, 54, 55]);
    }

    #[test]
    fn decrypts_file_attributes() {
        let key = [0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let encrypted = decode_base64_url("dc6Vaf8dj8pJJlarEixxhMrw6OHOKNDUr19n0b87wZ4").unwrap();
        let attributes = decrypt_attributes(&encrypted, &key).unwrap();
        assert_eq!(attributes["n"], "clip.mp4");
        assert_eq!(attributes["s"], 123);
    }

    #[test]
    fn decrypts_a_seeked_counter_range() {
        let key = [0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let nonce = [16u8, 17, 18, 19, 20, 21, 22, 23];
        let plaintext = b"MEGA CTR test vector: 0123456789 abcdefghijklmnopqrstuvwxyz";
        let mut encrypted = vec![
            173, 13, 232, 46, 137, 206, 241, 247, 248, 183, 130, 235, 88, 243, 181, 189, 249, 243,
            108, 153, 63, 68, 225, 230, 89, 1, 239, 105, 180, 111, 160, 93, 205, 108, 17, 85, 189,
            241, 200, 0, 29, 60, 125, 48, 119, 84, 95, 30, 78, 18, 194, 226, 175, 208, 1, 198, 126,
            126, 164,
        ];
        let mut cipher = ctr_cipher(&key, &nonce, 3).unwrap();
        cipher.apply_keystream(&mut encrypted);
        assert_eq!(encrypted, plaintext);
    }
}
