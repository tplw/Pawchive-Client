use super::{
    Timed, GOFILE_ACCOUNT_TTL, GOFILE_LANGUAGE, GOFILE_SECRET_TTL, GOFILE_USER_AGENT,
    REQUEST_TIMEOUT,
};
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::MediaKind;
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

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
    pub(super) fn new(client: reqwest::Client) -> Self {
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

    pub(super) async fn contents(&self, content_id: &str) -> AppResult<(Value, String)> {
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

pub(super) struct GofileFile {
    pub(super) name: String,
    pub(super) size: u64,
    pub(super) link: String,
}

pub(super) fn pick_gofile_file(data: &Value) -> AppResult<GofileFile> {
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

/// The file is obfuscated with the usual string-array scheme: every literal is
/// stored as a custom-base64 + RC4 encrypted array entry, and call sites pass
/// the decryption key. We do not evaluate the JavaScript; instead we try every
/// array entry with every literal key and keep the value that is a 14-hex
/// secret. This survives server-side secret rotation as long as the obfuscator
/// keeps the same layout.
pub(super) fn extract_website_secret(source: &str) -> Option<String> {
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
