use crate::infra::providers::{provider_for_url, MediaProvider};
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::MediaKind;
use crate::shared::security::validate_media_remote_url;
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RESOLVE_TTL: Duration = Duration::from_secs(10 * 60);
const GOFILE_ACCOUNT_TTL: Duration = Duration::from_secs(45 * 60);
const GOFILE_SECRET_TTL: Duration = Duration::from_secs(45 * 60);
const GOFILE_LANGUAGE: &str = "en-US";
/// GoFile fingerprints the browser that generated the website token, so every
/// request in a session must use the same user agent.
pub const GOFILE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// Metadata for a file hosted outside Pawchive.
#[derive(Debug, Clone)]
pub struct RemoteMedia {
    pub provider: MediaProvider,
    /// Direct upstream URL. It may contain an expiring provider token.
    pub url: String,
    pub name: String,
    pub size: u64,
    pub content_type: String,
    pub kind: MediaKind,
    /// Extra headers the provider needs when the loopback server streams it.
    pub headers: Vec<(String, String)>,
    pub etag: String,
}

impl RemoteMedia {
    pub fn source(&self, client: reqwest::Client) -> crate::infra::local_http::RemoteSource {
        crate::infra::local_http::RemoteSource {
            client,
            url: self.url.clone(),
            headers: self.headers.clone(),
            size: self.size,
            content_type: self.content_type.clone(),
            etag: self.etag.clone(),
        }
    }

    pub fn apply_headers(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut request = request;
        for (name, value) in &self.headers {
            request = request.header(name, value);
        }
        request
    }
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

#[derive(Debug, Default)]
struct GofileState {
    account: Option<Timed<String>>,
    secret: Option<Timed<String>>,
    /// After a network failure or rate limit, stop hammering GoFile from every
    /// attachment in a post. The resolver retries once this instant passes.
    blocked_until: Option<Instant>,
}

/// Resolves GoFile share links. The public API requires a guest account plus a
/// rotating website token derived from the JavaScript served by gofile.io.
pub struct GofileResolver {
    client: reqwest::Client,
    state: Mutex<GofileState>,
}

impl GofileResolver {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            state: Mutex::new(GofileState::default()),
        }
    }

    async fn account(&self, state: &mut GofileState) -> AppResult<String> {
        if let Some(account) = state
            .account
            .as_ref()
            .filter(|account| account.fresh(GOFILE_ACCOUNT_TTL))
        {
            return Ok(account.value.clone());
        }
        let request = self
            .client
            .post("https://api.gofile.io/accounts")
            .header(reqwest::header::USER_AGENT, GOFILE_USER_AGENT)
            .header(reqwest::header::ACCEPT_LANGUAGE, GOFILE_LANGUAGE)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::ORIGIN, "https://gofile.io")
            .header(reqwest::header::REFERER, "https://gofile.io/");
        let response = tokio::time::timeout(REQUEST_TIMEOUT, request.send())
            .await
            .map_err(|_| AppError::Timeout)?
            .map_err(|error| {
                AppError::Network(crate::shared::security::network_error_message(&error))
            })?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let token = body
            .get("data")
            .and_then(|data| data.get("token"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string);
        if let Some(token) = token {
            state.account = Some(Timed {
                value: token.clone(),
                at: Instant::now(),
            });
            return Ok(token);
        }
        let api_status = body
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if api_status == "error-rateLimit" || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::Unavailable(
                "GoFile is rate-limiting guest access; try again in a few minutes".into(),
            ));
        }
        Err(AppError::Unavailable(
            "GoFile did not issue a guest account".into(),
        ))
    }

    async fn secret(&self, state: &mut GofileState) -> AppResult<String> {
        if let Some(secret) = state
            .secret
            .as_ref()
            .filter(|secret| secret.fresh(GOFILE_SECRET_TTL))
        {
            return Ok(secret.value.clone());
        }
        let request = self
            .client
            .get("https://gofile.io/js/wt.obf.js")
            .header(reqwest::header::USER_AGENT, GOFILE_USER_AGENT)
            .header(reqwest::header::ACCEPT_LANGUAGE, GOFILE_LANGUAGE)
            .header(reqwest::header::ACCEPT, "*/*")
            .header(reqwest::header::REFERER, "https://gofile.io/");
        let response = tokio::time::timeout(REQUEST_TIMEOUT, request.send())
            .await
            .map_err(|_| AppError::Timeout)?
            .map_err(|error| {
                AppError::Network(crate::shared::security::network_error_message(&error))
            })?;
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "GoFile's website token script answered HTTP {}",
                response.status().as_u16()
            )));
        }
        let source = response.text().await.map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
        let secret = extract_website_secret(&source).ok_or_else(|| {
            AppError::Unavailable("could not read GoFile's rotating website token".into())
        })?;
        state.secret = Some(Timed {
            value: secret.clone(),
            at: Instant::now(),
        });
        Ok(secret)
    }

    fn token(account: &str, secret: &str) -> String {
        let bucket = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() / 14_400)
            .unwrap_or_default();
        let preimage =
            format!("{GOFILE_USER_AGENT}::{GOFILE_LANGUAGE}::{account}::{bucket}::{secret}");
        format!("{:x}", Sha256::digest(preimage.as_bytes()))
    }

    async fn contents(&self, content_id: &str) -> AppResult<(Value, String)> {
        let mut state = self.state.lock().await;
        if let Some(until) = state.blocked_until {
            if Instant::now() < until {
                return Err(AppError::Unavailable(
                    "GoFile is temporarily unavailable; try again shortly".into(),
                ));
            }
        }
        for attempt in 0..2 {
            let account = match self.account(&mut state).await {
                Ok(account) => account,
                Err(error) => {
                    state.blocked_until = Some(Instant::now() + Duration::from_secs(60));
                    return Err(error);
                }
            };
            let secret = match self.secret(&mut state).await {
                Ok(secret) => secret,
                Err(error) => {
                    state.blocked_until = Some(Instant::now() + Duration::from_secs(60));
                    return Err(error);
                }
            };
            let token = Self::token(&account, &secret);
            let request = self
                .client
                .get(format!(
                    "https://api.gofile.io/contents/{content_id}?page=1&pageSize=100&sortField=name&sortDirection=1"
                ))
                .header(reqwest::header::USER_AGENT, GOFILE_USER_AGENT)
                .header(reqwest::header::ACCEPT_LANGUAGE, GOFILE_LANGUAGE)
                .header(reqwest::header::ACCEPT, "application/json")
                .header("X-BL", GOFILE_LANGUAGE)
                .header("X-Website-Token", &token)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {account}"))
                .header(reqwest::header::COOKIE, format!("accountToken={account}"))
                .header(reqwest::header::ORIGIN, "https://gofile.io")
                .header(reqwest::header::REFERER, "https://gofile.io/");
            let response = match tokio::time::timeout(REQUEST_TIMEOUT, request.send()).await {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => {
                    state.blocked_until = Some(Instant::now() + Duration::from_secs(60));
                    return Err(AppError::Network(
                        crate::shared::security::network_error_message(&error),
                    ));
                }
                Err(_) => {
                    state.blocked_until = Some(Instant::now() + Duration::from_secs(60));
                    return Err(AppError::Timeout);
                }
            };
            let status = response.status();
            let body: Value = response.json().await.unwrap_or(Value::Null);
            let api_status = body
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if api_status == "ok" {
                let data = body.get("data").cloned().unwrap_or(Value::Null);
                return Ok((data, account));
            }
            // A stale secret or guest account is reported as notPremium. Drop
            // both caches and retry once with freshly fetched credentials.
            if attempt == 0
                && (api_status == "error-notPremium" || status == reqwest::StatusCode::UNAUTHORIZED)
            {
                state.account = None;
                state.secret = None;
                continue;
            }
            if api_status == "error-rateLimit" {
                state.blocked_until = Some(Instant::now() + Duration::from_secs(300));
            }
            return Err(match api_status {
                "error-rateLimit" => AppError::Unavailable(
                    "GoFile is rate-limiting requests; try again in a few minutes".into(),
                ),
                "error-password" | "error-wrongPassword" => {
                    AppError::Unavailable("this GoFile link is password protected".into())
                }
                "error-notFound" => AppError::NotFound,
                "error-notPremium" => AppError::Unavailable(
                    "GoFile rejected the guest session; try again later".into(),
                ),
                _ => AppError::Unavailable(format!(
                    "GoFile answered HTTP {} ({api_status})",
                    status.as_u16()
                )),
            });
        }
        Err(AppError::Unavailable(
            "GoFile rejected the guest session".into(),
        ))
    }
}

/// Shared resolver and short-lived cache for Google Drive, Dropbox and GoFile.
pub struct RemoteResolver {
    client: reqwest::Client,
    gofile: GofileResolver,
    cache: Mutex<HashMap<String, Timed<RemoteMedia>>>,
}

impl RemoteResolver {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            gofile: GofileResolver::new(client.clone()),
            client,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub async fn resolve(&self, raw: &str) -> AppResult<RemoteMedia> {
        let key = raw.trim().to_string();
        {
            let cache = self.cache.lock().await;
            if let Some(hit) = cache.get(&key).filter(|hit| hit.fresh(RESOLVE_TTL)) {
                return Ok(hit.value.clone());
            }
        }
        let media = self.resolve_uncached(&key).await?;
        let mut cache = self.cache.lock().await;
        cache.insert(
            key,
            Timed {
                value: media.clone(),
                at: Instant::now(),
            },
        );
        Ok(media)
    }

    async fn resolve_uncached(&self, raw: &str) -> AppResult<RemoteMedia> {
        let provider = provider_for_url(raw);
        let (direct_url, fallback_name, fallback_size, headers) = match provider {
            MediaProvider::GoogleDrive => {
                let id = drive_file_id(raw).ok_or_else(|| {
                    AppError::Validation(
                        "only individual Google Drive file links can be played".into(),
                    )
                })?;
                (
                    format!(
                        "https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t"
                    ),
                    format!("drive-{id}"),
                    None,
                    vec![(
                        "Referer".to_string(),
                        "https://drive.google.com/".to_string(),
                    )],
                )
            }
            MediaProvider::Dropbox => {
                let url = dropbox_direct_url(raw)?;
                let name = url::Url::parse(&url)
                    .ok()
                    .and_then(|url| {
                        url.path_segments()
                            .and_then(|mut segments| segments.next_back())
                            .map(str::to_string)
                    })
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| "dropbox-media".to_string());
                (
                    url,
                    percent_decode(&name),
                    None,
                    vec![(
                        "Referer".to_string(),
                        "https://www.dropbox.com/".to_string(),
                    )],
                )
            }
            MediaProvider::Gofile => {
                let id = gofile_content_id(raw)
                    .ok_or_else(|| AppError::Validation("not a GoFile share link".into()))?;
                let (contents, account) = self.gofile.contents(&id).await?;
                let file = pick_gofile_file(&contents)?;
                (
                    file.link,
                    file.name,
                    Some(file.size),
                    vec![
                        ("Referer".to_string(), "https://gofile.io/".to_string()),
                        ("User-Agent".to_string(), GOFILE_USER_AGENT.to_string()),
                        ("Cookie".to_string(), format!("accountToken={account}")),
                    ],
                )
            }
            MediaProvider::Mega => {
                return Err(AppError::Validation(
                    "MEGA links are resolved by the MEGA resolver".into(),
                ))
            }
            _ => {
                return Err(AppError::Validation(
                    "not a supported external media provider link".into(),
                ))
            }
        };

        let direct_url = validate_media_remote_url(&direct_url)?.to_string();
        let probed = probe(&self.client, &direct_url, &headers, provider).await?;
        let name = ensure_extension(probed.name.unwrap_or(fallback_name), &probed.content_type);
        let content_type = normalize_content_type(&name, &probed.content_type);
        let size = probed.size.or(fallback_size).unwrap_or_default();
        if size == 0 {
            return Err(AppError::Unavailable(
                "the media provider did not report a file size".into(),
            ));
        }
        let kind = media_kind_for(&name, &content_type);
        Ok(RemoteMedia {
            provider,
            url: direct_url,
            name,
            size,
            content_type,
            kind,
            headers,
            etag: format!(
                "\"{}-{}\"",
                provider.as_str(),
                probed.etag.unwrap_or_else(|| format!("{size:x}"))
            ),
        })
    }
}

/// Build an attachment for a file discovered inside a provider folder.
fn folder_file_attachment(
    url: String,
    name: String,
    provider: MediaProvider,
) -> crate::shared::models::Attachment {
    crate::shared::models::Attachment {
        name: name.clone(),
        path: url.clone(),
        url: url.clone(),
        download_url: url,
        thumbnail_url: None,
        kind: crate::shared::security::media_kind_for(&name),
        provider,
        ext: crate::shared::security::file_extension(&name),
        preview_only: false,
    }
}

/// Expand public Google Drive and MEGA folder links into individual file
/// attachments. Failures keep the folder link visible (and marked preview-only
/// so the UI does not offer a download that cannot work).
pub async fn expand_folders(
    mega: &crate::infra::providers::mega::MegaResolver,
    remote: &RemoteResolver,
    attachments: Vec<crate::shared::models::Attachment>,
) -> Vec<crate::shared::models::Attachment> {
    let mut expanded = Vec::with_capacity(attachments.len());
    let mut seen_urls: std::collections::HashSet<String> =
        attachments.iter().map(|file| file.url.clone()).collect();
    for mut attachment in attachments {
        if let Some(folder_id) = drive_folder_id(&attachment.url) {
            if let Ok(files) = list_drive_folder(remote.client(), &folder_id).await {
                if !files.is_empty() {
                    for file in files {
                        let url = format!("https://drive.google.com/file/d/{}/view", file.id);
                        if !seen_urls.insert(url.clone()) {
                            continue;
                        }
                        expanded.push(folder_file_attachment(
                            url,
                            file.name,
                            MediaProvider::GoogleDrive,
                        ));
                    }
                    continue;
                }
            }
            attachment.name = "Google Drive folder".into();
            attachment.kind = crate::shared::models::MediaKind::Other;
            attachment.preview_only = true;
            expanded.push(attachment);
            continue;
        }
        if let Some(folder) = crate::infra::providers::mega::parse_folder_link(&attachment.url) {
            if let Ok(files) = mega.list_folder(&folder).await {
                if !files.is_empty() {
                    for file in files {
                        let url = format!(
                            "https://mega.nz/folder/{}#{}/file/{}",
                            folder.handle, folder.key, file.handle
                        );
                        if !seen_urls.insert(url.clone()) {
                            continue;
                        }
                        expanded.push(folder_file_attachment(url, file.name, MediaProvider::Mega));
                    }
                    continue;
                }
            }
            attachment.name = "MEGA folder".into();
            attachment.kind = crate::shared::models::MediaKind::Other;
            attachment.preview_only = true;
            expanded.push(attachment);
            continue;
        }
        expanded.push(attachment);
    }
    expanded
}

/// Providers that need a resolution pass before the webview can play them.
pub fn needs_resolution(raw: &str) -> bool {
    matches!(
        provider_for_url(raw),
        MediaProvider::GoogleDrive | MediaProvider::Dropbox | MediaProvider::Gofile
    )
}

struct Probed {
    size: Option<u64>,
    content_type: String,
    name: Option<String>,
    etag: Option<String>,
}

async fn probe(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    provider: MediaProvider,
) -> AppResult<Probed> {
    let mut request = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = tokio::time::timeout(REQUEST_TIMEOUT, request.send())
        .await
        .map_err(|_| AppError::Timeout)?
        .map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
    let status = response.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Err(AppError::Unavailable(
            "the media provider rejected the file range".into(),
        ));
    }
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(AppError::Unavailable(format!(
            "{} answered HTTP {}",
            provider_label(provider),
            status.as_u16()
        )));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    if content_type == "text/html" || content_type == "application/xhtml+xml" {
        return Err(AppError::Unavailable(format!(
            "{} returned a web page instead of a file; the link may be private, expired or over quota",
            provider_label(provider)
        )));
    }
    let size = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        // A partial response's Content-Length is only the requested byte
        // count, so the total must come from Content-Range.
        content_range_total(response.headers())
    } else {
        content_range_total(response.headers()).or_else(|| response.content_length())
    }
    .filter(|size| *size > 0);
    let name = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(filename_from_disposition);
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    Ok(Probed {
        size,
        content_type,
        name,
        etag,
    })
}

fn provider_label(provider: MediaProvider) -> &'static str {
    match provider {
        MediaProvider::GoogleDrive => "Google Drive",
        MediaProvider::Dropbox => "Dropbox",
        MediaProvider::Gofile => "GoFile",
        MediaProvider::Mega => "MEGA",
        MediaProvider::Pawchive => "Pawchive",
        MediaProvider::External => "the media provider",
    }
}

pub fn drive_file_id(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if !matches!(
        host.as_str(),
        "drive.google.com" | "docs.google.com" | "drive.usercontent.google.com"
    ) {
        return None;
    }
    let segments: Vec<_> = url
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();
    if let Some(position) = segments.iter().position(|segment| *segment == "d") {
        return valid_drive_id(segments.get(position + 1).copied());
    }
    let query_id = url
        .query_pairs()
        .find(|(name, _)| name == "id")
        .map(|(_, value)| value.into_owned());
    valid_drive_id(query_id.as_deref())
}

/// Extract the folder id from a `drive.google.com/drive/folders/<id>` link.
pub fn drive_folder_id(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if !matches!(host.as_str(), "drive.google.com" | "docs.google.com") {
        return None;
    }
    let segments: Vec<_> = url
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect();
    let position = segments.iter().position(|segment| *segment == "folders")?;
    valid_drive_id(segments.get(position + 1).copied())
}

/// A file (or subfolder) listed inside a public Google Drive folder.
#[derive(Debug, Clone)]
pub struct DriveFolderFile {
    pub id: String,
    pub name: String,
    pub is_folder: bool,
}

/// List the files in a public Google Drive folder using the lightweight
/// `embeddedfolderview` page. Subfolders are walked up to a small depth.
pub async fn list_drive_folder(
    client: &reqwest::Client,
    folder_id: &str,
) -> AppResult<Vec<DriveFolderFile>> {
    let mut pending = vec![(folder_id.to_string(), 0usize)];
    let mut files = Vec::new();
    let mut first = true;
    while let Some((id, depth)) = pending.pop() {
        let entries = match fetch_drive_folder_page(client, &id).await {
            Ok(entries) => entries,
            Err(error) => {
                if first {
                    return Err(error);
                }
                continue;
            }
        };
        first = false;
        for entry in entries {
            if entry.is_folder {
                if depth < 3 {
                    pending.push((entry.id, depth + 1));
                }
            } else {
                files.push(entry);
            }
        }
    }
    Ok(files)
}

async fn fetch_drive_folder_page(
    client: &reqwest::Client,
    folder_id: &str,
) -> AppResult<Vec<DriveFolderFile>> {
    let request = client
        .get(format!(
            "https://drive.google.com/embeddedfolderview?id={folder_id}"
        ))
        .header(reqwest::header::REFERER, "https://drive.google.com/");
    let response = tokio::time::timeout(REQUEST_TIMEOUT, request.send())
        .await
        .map_err(|_| AppError::Timeout)?
        .map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable(format!(
            "Google Drive folder answered HTTP {}",
            response.status().as_u16()
        )));
    }
    let html = response.text().await.map_err(|error| {
        AppError::Network(crate::shared::security::network_error_message(&error))
    })?;
    let entries = parse_drive_folder_html(&html);
    if entries.is_empty()
        && !html.contains("flip-entry")
        && html.to_ascii_lowercase().contains("<title>")
    {
        // A valid but empty folder still has an entries container; a 404-like
        // or sign-in page does not. Treat the latter as unavailable.
        return Err(AppError::Unavailable(
            "Google Drive did not return a public folder listing".into(),
        ));
    }
    Ok(entries)
}

fn parse_drive_folder_html(html: &str) -> Vec<DriveFolderFile> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r#"(?s)<div class="flip-entry"[^>]*id="entry-([A-Za-z0-9_-]+)".*?<a href="([^"]+)"[^>]*>.*?<div class="flip-entry-title">([^<]*)</div>"#,
        )
        .expect("valid Drive folder regex")
    });
    let mut entries = Vec::new();
    for captures in re.captures_iter(html) {
        let id = captures[1].to_string();
        let href = &captures[2];
        let name = html_unescape(captures[3].trim());
        entries.push(DriveFolderFile {
            id,
            name: if name.is_empty() {
                "drive-file".to_string()
            } else {
                name
            },
            is_folder: href.contains("/folders/"),
        });
    }
    entries
}

fn html_unescape(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn valid_drive_id(value: Option<&str>) -> Option<String> {
    value
        .filter(|value| {
            value.len() >= 10
                && value.len() <= 128
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        })
        .map(str::to_string)
}

pub fn dropbox_direct_url(raw: &str) -> AppResult<String> {
    let mut parsed = url::Url::parse(raw)?;
    if parsed.scheme() == "http" {
        let _ = parsed.set_scheme("https");
    }
    let mut url = validate_media_remote_url(parsed.as_str())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.ends_with(".dropboxusercontent.com") {
        return Ok(url.to_string());
    }
    if !(host == "dropbox.com" || host.ends_with(".dropbox.com") || host == "www.dropbox.com") {
        return Err(AppError::Validation("not a Dropbox link".into()));
    }
    {
        let mut pairs: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(name, _)| name != "dl" && name != "raw")
            .map(|(name, value)| (name.into_owned(), value.into_owned()))
            .collect();
        pairs.push(("raw".to_string(), "1".to_string()));
        url.set_query(None);
        {
            let mut query = url.query_pairs_mut();
            for (name, value) in pairs {
                query.append_pair(&name, &value);
            }
        }
    }
    Ok(url.to_string())
}

pub fn gofile_content_id(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if host != "gofile.io" && !host.ends_with(".gofile.io") {
        return None;
    }
    let segments: Vec<_> = url
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.first() != Some(&"d") {
        return None;
    }
    segments
        .get(1)
        .filter(|value| {
            value.len() >= 6
                && value.len() <= 64
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        })
        .map(|value| value.to_string())
}

struct GofileFile {
    name: String,
    size: u64,
    link: String,
}

fn pick_gofile_file(data: &Value) -> AppResult<GofileFile> {
    if data.get("canAccess").and_then(Value::as_bool) == Some(false) {
        return Err(AppError::Unavailable(
            "this GoFile link is password protected".into(),
        ));
    }
    let mut files = Vec::new();
    collect_gofile_files(data, 0, &mut files);
    let best = files
        .into_iter()
        .max_by_key(|(kind, size, _)| (*kind, *size));
    let Some((_, size, value)) = best else {
        return Err(AppError::Unavailable(
            "this GoFile link does not contain a downloadable file".into(),
        ));
    };
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("gofile-media")
        .to_string();
    let link = value
        .get("link")
        .or_else(|| value.get("directLink"))
        .and_then(Value::as_str)
        .filter(|link| link.starts_with("https://"))
        .ok_or_else(|| {
            AppError::Unavailable("GoFile did not provide a download link for this file".into())
        })?
        .to_string();
    Ok(GofileFile { name, size, link })
}

fn collect_gofile_files(value: &Value, depth: usize, files: &mut Vec<(u8, u64, Value)>) {
    if depth > 4 {
        return;
    }
    let content_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if content_type == "file" {
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let size = value.get("size").and_then(Value::as_u64).unwrap_or(0);
        if size > 0 && value.get("link").and_then(Value::as_str).is_some() {
            files.push((media_priority(name), size, value.clone()));
        }
        return;
    }
    if let Some(children) = value.get("children") {
        match children {
            Value::Object(map) => {
                for child in map.values() {
                    collect_gofile_files(child, depth + 1, files);
                }
            }
            Value::Array(items) => {
                for child in items {
                    collect_gofile_files(child, depth + 1, files);
                }
            }
            _ => {}
        }
    }
}

fn media_priority(name: &str) -> u8 {
    match crate::shared::security::media_kind_for(name) {
        MediaKind::Video => 3,
        MediaKind::Image => 2,
        MediaKind::Audio => 1,
        _ => 0,
    }
}

fn media_kind_for(name: &str, content_type: &str) -> MediaKind {
    if content_type.starts_with("video/") {
        return MediaKind::Video;
    }
    if content_type.starts_with("audio/") {
        return MediaKind::Audio;
    }
    if content_type.starts_with("image/") {
        return MediaKind::Image;
    }
    crate::shared::security::media_kind_for(name)
}

fn ensure_extension(name: String, content_type: &str) -> String {
    if Path::new(&name).extension().is_some() {
        return name;
    }
    let extension = match content_type {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return name,
    };
    format!("{name}.{extension}")
}

/// Providers sometimes label every file as `application/octet-stream`. The
/// webview's media elements need a real MIME type, so fall back to the
/// filename for the loopback server.
fn normalize_content_type(name: &str, content_type: &str) -> String {
    if content_type == "application/octet-stream" || content_type == "binary/octet-stream" {
        let mapped = crate::infra::local_http::content_type_for_name(name);
        if mapped != "application/octet-stream" {
            return mapped.to_string();
        }
    }
    content_type.to_string()
}

fn content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|total| total.trim().parse::<u64>().ok())
}

pub fn filename_from_disposition(raw: &str) -> Option<String> {
    // RFC 5987 form takes precedence; Dropbox and Google Drive both use it
    // for non-ASCII names.
    if let Some(index) = raw.to_ascii_lowercase().find("filename*=") {
        let value = raw[index + "filename*=".len()..].trim();
        let value = value.split(';').next().unwrap_or(value).trim();
        if let Some((encoding, value)) = value.split_once("''") {
            if encoding.eq_ignore_ascii_case("utf-8") {
                return Some(percent_decode(value.trim_matches('"')));
            }
        }
    }
    let lower = raw.to_ascii_lowercase();
    let index = lower.find("filename=")?;
    let value = raw[index + "filename=".len()..].trim();
    let value = value.split(';').next().unwrap_or(value).trim();
    let value = value.trim_matches('"').trim();
    if value.is_empty() {
        None
    } else {
        Some(percent_decode(value))
    }
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/* ------------------------------------------------------------------------- */
/* GoFile website-token extraction                                            */
/* ------------------------------------------------------------------------- */

/// Decode the rotating 14-hex secret baked into `wt.obf.js`.
///
/// The file is obfuscated with the usual string-array scheme: every literal is
/// stored as a custom-base64 + RC4 encrypted array entry, and call sites pass
/// the decryption key. We do not evaluate the JavaScript; instead we try every
/// array entry with every literal key and keep the value that is a 14-hex
/// secret. This survives server-side secret rotation as long as the obfuscator
/// keeps the same layout.
pub fn extract_website_secret(source: &str) -> Option<String> {
    let arrays = js_string_arrays(source);
    let keys = js_string_keys(source);
    if arrays.is_empty() || keys.is_empty() {
        return None;
    }
    let mut found: Option<String> = None;
    for entries in &arrays {
        for entry in entries {
            for key in &keys {
                let Some(decoded) = decode_entry(entry, key) else {
                    continue;
                };
                if decoded.len() == 14 && decoded.chars().all(|ch| ch.is_ascii_hexdigit()) {
                    let decoded = decoded.to_ascii_lowercase();
                    if let Some(previous) = &found {
                        if previous != &decoded {
                            return None;
                        }
                    } else {
                        found = Some(decoded);
                    }
                }
            }
        }
    }
    found
}

fn js_string_arrays(source: &str) -> Vec<Vec<String>> {
    // The obfuscator names its array helper randomly, so locate every array
    // that consists purely of string literals instead of matching a generated
    // function name. The main string table is the largest, but returning all
    // candidates keeps this working if a new build adds another array.
    let bytes = source.as_bytes();
    let mut arrays = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = source[cursor..].find('[') {
        let open = cursor + offset;
        if let Some(entries) = parse_string_list(bytes, open) {
            if entries.len() >= 2 {
                arrays.push(entries);
            }
        }
        cursor = open + 1;
    }
    arrays
}

fn parse_string_list(bytes: &[u8], open: usize) -> Option<Vec<String>> {
    let mut index = open + 1;
    let mut entries = Vec::new();
    loop {
        while index < bytes.len() && (bytes[index] as char).is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        if bytes[index] == b']' {
            return Some(entries);
        }
        if bytes[index] != b'\'' {
            return None;
        }
        index += 1;
        let mut raw = Vec::new();
        let mut escaped = false;
        let mut closed = false;
        while index < bytes.len() {
            let byte = bytes[index];
            if escaped {
                raw.push(b'\\');
                raw.push(byte);
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'\'' {
                closed = true;
                index += 1;
                break;
            } else {
                raw.push(byte);
            }
            index += 1;
        }
        if !closed {
            return None;
        }
        entries.push(js_unescape(&String::from_utf8_lossy(&raw)));
        while index < bytes.len() && (bytes[index] as char).is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        match bytes[index] {
            b',' => index += 1,
            b']' => return Some(entries),
            _ => return None,
        }
    }
}

fn js_string_keys(source: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"\(0x[0-9a-fA-F]+,\s*'((?:[^'\\]|\\.)*)'\)").expect("valid key regex")
    });
    let mut keys = Vec::new();
    for captures in re.captures_iter(source) {
        let key = js_unescape(&captures[1]);
        if !key.is_empty() && !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

fn js_unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('x') => {
                let hex: String = chars.by_ref().take(2).collect();
                if let Ok(value) = u8::from_str_radix(&hex, 16) {
                    out.push(value as char);
                }
            }
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(value) = u32::from_str_radix(&hex, 16) {
                    if let Some(ch) = char::from_u32(value) {
                        out.push(ch);
                    }
                }
            }
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

const OBFUSCATED_ALPHABET: &str =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";

fn decode_entry(entry: &str, key: &str) -> Option<String> {
    // Custom base64, matching the decoder emitted by the obfuscator. The `=`
    // entry is a normal alphabet value here, not padding.
    let mut binary = Vec::with_capacity(entry.len() * 3 / 4);
    let mut accumulator: u32 = 0;
    for (index, ch) in entry.chars().enumerate() {
        let value = OBFUSCATED_ALPHABET.find(ch)? as u32;
        if index.is_multiple_of(4) {
            accumulator = value;
        } else {
            accumulator = accumulator.wrapping_mul(64).wrapping_add(value);
            let shift = ((-2 * (index as i32 + 1)) & 6) as u32;
            binary.push(((accumulator >> shift) & 0xff) as u8);
        }
    }
    let text = String::from_utf8(binary).ok()?;
    rc4(&text, key.as_bytes())
}

/// The obfuscator's RC4 operates on JavaScript UTF-16 code units, so decode
/// over characters rather than the UTF-8 byte representation.
fn rc4(text: &str, key: &[u8]) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    let mut schedule = [0u8; 256];
    for (index, value) in schedule.iter_mut().enumerate() {
        *value = index as u8;
    }
    let mut j = 0usize;
    for index in 0..256 {
        j = (j + schedule[index] as usize + key[index % key.len()] as usize) % 256;
        schedule.swap(index, j);
    }
    let mut i = 0usize;
    j = 0usize;
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        i = (i + 1) % 256;
        j = (j + schedule[i] as usize) % 256;
        schedule.swap(i, j);
        let stream = schedule[(schedule[i] as usize + schedule[j] as usize) % 256] as u32;
        out.push(char::from_u32((ch as u32) ^ stream)?);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_drive_file_ids() {
        assert_eq!(
            drive_file_id("https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view?usp=sharing")
                .as_deref(),
            Some("13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv")
        );
        assert_eq!(
            drive_file_id("https://drive.google.com/open?id=1rRXLabcdefghijklmnop").as_deref(),
            Some("1rRXLabcdefghijklmnop")
        );
        assert_eq!(
            drive_file_id("https://drive.google.com/drive/folders/abc"),
            None
        );
    }

    #[test]
    fn extracts_drive_folder_ids() {
        assert_eq!(
            drive_folder_id(
                "https://drive.google.com/drive/folders/1megyDZ_AK9oFl-OzFzIz7NcZ_s1l9wz-?usp=sharing"
            )
            .as_deref(),
            Some("1megyDZ_AK9oFl-OzFzIz7NcZ_s1l9wz-")
        );
        assert_eq!(
            drive_folder_id(
                "https://drive.google.com/file/d/13Ln54rOyA7C98ACx-k6KASb4OVYSF9iv/view"
            ),
            None
        );
    }

    #[test]
    fn parses_drive_folder_listing_entries() {
        let html = r#"
            <div class="flip-entry" id="entry-1Q511Gx2k6T7B6TNVZnZjwjulr2N-yEP4" tabindex="0">
              <div class="flip-entry-info"><a href="https://drive.google.com/file/d/1Q511Gx2k6T7B6TNVZnZjwjulr2N-yEP4/view?usp=drive_web">
                <div class="flip-entry-title">1080 Nude.zip</div></a></div>
            </div>
            <div class="flip-entry" id="entry-1wBv63qrlEP0jXi5533jYqdpuTzwRDN38" tabindex="0">
              <div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/1wBv63qrlEP0jXi5533jYqdpuTzwRDN38">
                <div class="flip-entry-title">More files</div></a></div>
            </div>
        "#;
        let entries = parse_drive_folder_html(html);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "1080 Nude.zip");
        assert!(!entries[0].is_folder);
        assert_eq!(entries[1].name, "More files");
        assert!(entries[1].is_folder);
    }

    #[test]
    fn normalizes_dropbox_links() {
        let url =
            dropbox_direct_url("http://dropbox.com/scl/fi/abc/clip.mp4?rlkey=key&dl=0").unwrap();
        assert!(url.starts_with("https://dropbox.com/scl/fi/abc/clip.mp4?"));
        assert!(url.contains("raw=1"));
        assert!(!url.contains("dl=0"));
    }

    #[test]
    fn extracts_gofile_ids() {
        assert_eq!(
            gofile_content_id("https://gofile.io/d/41qLzaRk").as_deref(),
            Some("41qLzaRk")
        );
        assert_eq!(gofile_content_id("https://gofile.io/d/"), None);
    }

    #[test]
    fn maps_generic_provider_content_types_from_the_filename() {
        assert_eq!(
            normalize_content_type("clip.mp4", "application/octet-stream"),
            "video/mp4"
        );
        assert_eq!(
            normalize_content_type("cover.jpg", "binary/octet-stream"),
            "image/jpeg"
        );
        assert_eq!(
            normalize_content_type("archive.rar", "application/octet-stream"),
            "application/octet-stream"
        );
    }

    #[test]
    fn parses_content_disposition_names() {
        assert_eq!(
            filename_from_disposition("attachment; filename=\"fanbox80.mp4\"").as_deref(),
            Some("fanbox80.mp4")
        );
        assert_eq!(
            filename_from_disposition("attachment; filename*=UTF-8''cl%20ip.mp4").as_deref(),
            Some("cl ip.mp4")
        );
    }

    #[test]
    fn picks_the_largest_playable_gofile_child() {
        let data = serde_json::json!({
            "type": "folder",
            "canAccess": true,
            "children": {
                "a": {"type": "file", "name": "readme.txt", "size": 10, "link": "https://store1.gofile.io/download/web/a/readme.txt"},
                "b": {"type": "file", "name": "clip.mp4", "size": 500, "link": "https://store1.gofile.io/download/web/b/clip.mp4"},
                "c": {"type": "file", "name": "cover.jpg", "size": 900, "link": "https://store1.gofile.io/download/web/c/cover.jpg"}
            }
        });
        let file = pick_gofile_file(&data).unwrap();
        assert_eq!(file.name, "clip.mp4");
        assert_eq!(file.size, 500);
    }

    #[test]
    fn rejects_protected_gofile_content() {
        let data = serde_json::json!({"canAccess": false, "type": "folder"});
        assert!(pick_gofile_file(&data).is_err());
    }

    #[test]
    fn extracts_the_website_secret_from_obfuscated_javascript() {
        // Trimmed from the real wt.obf.js: the secret entry decodes with the
        // `zpTj` key, and another entry with a different key must be ignored.
        let source = r#"(function(){})(a0_0x2977,0x1);
function a0_0x2977(){var _0x1e7f51=['\x57\x51\x52\x63\x4a\x78\x6c\x63\x55\x38\x6f\x2b\x6c\x6d\x6f\x79\x57\x36\x4f\x45\x75\x6d\x6b\x58\x6e\x6d\x6f\x48\x57\x4f\x61','\x57\x50\x6c\x63\x49\x76\x64\x64\x55\x71'];a0_0x2977=function(){return _0x1e7f51;};return a0_0x2977();}
var x=a0_0x3ca6(0x227,'\x7a\x70\x54\x6a');"#;
        assert_eq!(
            extract_website_secret(source).as_deref(),
            Some("12af056dacea0b")
        );
    }
}
