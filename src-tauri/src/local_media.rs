use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone)]
enum MediaSource {
    File(PathBuf),
    Mega(Arc<crate::mega::MegaStream>),
}

/// A tiny loopback HTTP server for downloaded media.
///
/// WKWebView's custom asset protocol does not reliably support the Range
/// requests used by HTML video. Serving local files over localhost gives the
/// webview normal HTTP range support, which is required for seeking and for
/// large offline videos. Registered MEGA streams use the same route so the
/// player does not need a separate code path.
#[derive(Clone)]
pub struct LocalMediaServer {
    base_url: String,
    tokens: Arc<Mutex<HashMap<String, MediaSource>>>,
}

impl LocalMediaServer {
    pub fn start() -> AppResult<Self> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|error| AppError::Io(format!("could not start media server: {error}")))?;
        let port = listener
            .local_addr()
            .map_err(|error| AppError::Io(format!("could not read media server address: {error}")))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| AppError::Io(format!("could not configure media server: {error}")))?;

        let server = Self {
            base_url: format!("http://127.0.0.1:{port}"),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        };
        let task_server = server.clone();
        tauri::async_runtime::spawn(async move {
            let listener = match TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    tracing::error!(%error, "local media server could not start");
                    return;
                }
            };
            loop {
                match listener.accept().await {
                    Ok((socket, _)) => {
                        let state = task_server.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = handle_connection(socket, state).await {
                                tracing::debug!(%error, "local media request failed");
                            }
                        });
                    }
                    Err(error) => {
                        tracing::warn!(%error, "local media server stopped accepting requests");
                        break;
                    }
                }
            }
        });
        Ok(server)
    }

    pub fn url_for(&self, path: &Path) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(token.clone(), MediaSource::File(path.to_path_buf()));
        }
        format!("{}/media/{token}", self.base_url)
    }

    /// Register a decrypted MEGA range stream and return the loopback URL the
    /// webview can play just like any other media file.
    pub fn register_mega(&self, stream: crate::mega::MegaStream) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(token.clone(), MediaSource::Mega(Arc::new(stream)));
        }
        format!("{}/media/{token}", self.base_url)
    }

    #[cfg(test)]
    pub fn test_instance() -> Self {
        Self {
            base_url: "http://127.0.0.1:0".into(),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

async fn read_request(socket: &mut TcpStream) -> std::io::Result<Option<String>> {
    let mut data = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        let read = socket.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
        if data.windows(4).any(|window| window == b"\r\n\r\n") || data.len() >= 65_536 {
            break;
        }
    }
    if data.is_empty() {
        Ok(None)
    } else {
        Ok(Some(String::from_utf8_lossy(&data).into_owned()))
    }
}

async fn handle_connection(mut socket: TcpStream, server: LocalMediaServer) -> std::io::Result<()> {
    let Some(request) = read_request(&mut socket).await? else {
        return Ok(());
    };
    let (method, target) = {
        let request_line = request.lines().next().unwrap_or_default();
        let mut parts = request_line.split_whitespace();
        (
            parts.next().unwrap_or_default().to_string(),
            parts.next().unwrap_or_default().to_string(),
        )
    };

    if method == "OPTIONS" {
        let response = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, If-None-Match\r\nAccess-Control-Max-Age: 86400\r\nConnection: close\r\n\r\n";
        return socket.write_all(response.as_bytes()).await;
    }
    if method != "GET" && method != "HEAD" {
        return respond_status(&mut socket, "405 Method Not Allowed", "method not allowed").await;
    }

    let token = target
        .strip_prefix("/media/")
        .and_then(|rest| rest.split('?').next())
        .unwrap_or_default()
        .to_string();
    let source = server
        .tokens
        .lock()
        .ok()
        .and_then(|tokens| tokens.get(&token).cloned());
    let Some(source) = source else {
        return respond_status(&mut socket, "404 Not Found", "media not found").await;
    };

    match source {
        MediaSource::File(path) => serve_file(socket, request, &method, path).await,
        MediaSource::Mega(stream) => serve_mega(socket, request, &method, stream).await,
    }
}

async fn serve_file(
    mut socket: TcpStream,
    request: String,
    method: &str,
    path: PathBuf,
) -> std::io::Result<()> {
    let mut file = match File::open(&path).await {
        Ok(file) => file,
        Err(_) => return respond_status(&mut socket, "404 Not Found", "media not found").await,
    };
    let metadata = file.metadata().await?;
    let length = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let etag = format!("\"{length:x}-{modified:x}\"");
    if is_not_modified(&request, &etag) {
        return respond_not_modified(&mut socket, &etag).await;
    }

    let range = parse_range(&request, length);
    let content_type = content_type(&path);

    let (status, start, end) = match range {
        Some((start, end)) => ("206 Partial Content", start, end),
        None => ("200 OK", 0, length.saturating_sub(1)),
    };
    let body_length = if length == 0 {
        0
    } else {
        end.saturating_sub(start) + 1
    };
    write_media_headers(
        &mut socket,
        status,
        content_type,
        body_length,
        &etag,
        Some((start, end, length)),
    )
    .await?;

    if method == "GET" && body_length > 0 {
        file.seek(SeekFrom::Start(start)).await?;
        let mut limited = file.take(body_length);
        tokio::io::copy(&mut limited, &mut socket).await?;
    }
    Ok(())
}

async fn serve_mega(
    mut socket: TcpStream,
    request: String,
    method: &str,
    stream: Arc<crate::mega::MegaStream>,
) -> std::io::Result<()> {
    let length = stream.file.size;
    let etag = format!("\"mega-{}-{length:x}\"", stream.link.handle);
    if is_not_modified(&request, &etag) {
        return respond_not_modified(&mut socket, &etag).await;
    }

    let range = parse_range(&request, length);
    let content_type = content_type_for_name(&stream.file.name);

    let (status, start, end) = match range {
        Some((start, end)) => ("206 Partial Content", start, end),
        None => ("200 OK", 0, length.saturating_sub(1)),
    };
    let body_length = if length == 0 {
        0
    } else {
        end.saturating_sub(start) + 1
    };

    // Open the upstream range before writing headers so an expired link or
    // MEGA error still produces a real HTTP error instead of a truncated 200.
    let mut reader = if method == "GET" && body_length > 0 {
        match stream.open(start, end).await {
            Ok(reader) => Some(reader),
            Err(error) => {
                tracing::warn!(%error, "could not open MEGA media range");
                return respond_status(&mut socket, "502 Bad Gateway", "MEGA media is unavailable")
                    .await;
            }
        }
    } else {
        None
    };

    write_media_headers(
        &mut socket,
        status,
        content_type,
        body_length,
        &etag,
        if length == 0 {
            None
        } else {
            Some((start, end, length))
        },
    )
    .await?;

    if let Some(reader) = reader.as_mut() {
        loop {
            match reader.next_chunk().await {
                Ok(Some(chunk)) => socket.write_all(&chunk).await?,
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "MEGA media stream ended early");
                    break;
                }
            }
        }
    }
    Ok(())
}

fn is_not_modified(request: &str, etag: &str) -> bool {
    let has_range = request
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("range:"));
    !has_range
        && request
            .lines()
            .find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("if-none-match"))
                    .map(|(_, value)| value.trim() == etag)
            })
            .unwrap_or(false)
}

async fn respond_not_modified(socket: &mut TcpStream, etag: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 304 Not Modified\r\nETag: {etag}\r\nCache-Control: public, max-age=31536000, immutable\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
    );
    socket.write_all(response.as_bytes()).await
}

async fn write_media_headers(
    socket: &mut TcpStream,
    status: &str,
    content_type: &str,
    body_length: u64,
    etag: &str,
    range: Option<(u64, u64, u64)>,
) -> std::io::Result<()> {
    let mut headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {body_length}\r\nAccept-Ranges: bytes\r\nCache-Control: public, max-age=31536000, immutable\r\nETag: {etag}\r\nContent-Disposition: inline\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range, If-None-Match\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, ETag\r\nConnection: close\r\n"
    );
    if status.starts_with("206") {
        if let Some((start, end, length)) = range {
            headers.push_str(&format!("Content-Range: bytes {start}-{end}/{length}\r\n"));
        }
    }
    headers.push_str("\r\n");
    socket.write_all(headers.as_bytes()).await
}

async fn respond_status(
    socket: &mut TcpStream,
    status: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = message.as_bytes();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );
    socket.write_all(response.as_bytes()).await?;
    socket.write_all(body).await
}

fn parse_range(request: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    for line in request.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if !name.eq_ignore_ascii_case("range") {
            continue;
        }
        let spec = value.trim().strip_prefix("bytes=")?;
        let (start, end) = spec.split_once('-')?;
        if start.trim().is_empty() {
            let suffix = end.trim().parse::<u64>().ok()?;
            if suffix == 0 {
                return None;
            }
            return Some((length.saturating_sub(suffix), length - 1));
        }
        let start = start.trim().parse::<u64>().ok()?;
        if start >= length {
            return None;
        }
        let end = if end.trim().is_empty() {
            length - 1
        } else {
            end.trim().parse::<u64>().ok()?
        };
        if end < start {
            return None;
        }
        return Some((start, end.min(length - 1)));
    }
    None
}

fn content_type(path: &Path) -> &'static str {
    content_type_for_name(&path.to_string_lossy())
}

/// Map a filename (including a MEGA attribute name) to the content type the
/// loopback server reports to the webview.
pub fn content_type_for_name(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" | "m4b" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "3gp" => "video/3gpp",
        "ts" => "video/mp2t",
        "m3u8" => "application/vnd.apple.mpegurl",
        "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_byte_ranges() {
        assert_eq!(parse_range("Range: bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("Range: bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range("Range: bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("Range: bytes=200-", 100), None);
        assert_eq!(parse_range("Range: bytes=10-5", 100), None);
        assert_eq!(parse_range("Accept: text/plain", 100), None);
    }

    #[tokio::test]
    async fn serves_byte_ranges() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        std::fs::write(&path, b"0123456789").unwrap();
        let server = LocalMediaServer::start().unwrap();
        let url = server.url_for(&path);
        let response = reqwest::Client::new()
            .get(url)
            .header(reqwest::header::RANGE, "bytes=2-5")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers()[reqwest::header::CONTENT_RANGE],
            "bytes 2-5/10"
        );
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"2345");
    }

    #[tokio::test]
    async fn streams_a_decrypted_mega_range() {
        use wiremock::matchers::{header, method};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let plaintext = b"MEGA CTR test vector: 0123456789 abcdefghijklmnopqrstuvwxyz";
        let encrypted = [
            192u8, 163, 159, 129, 253, 24, 152, 202, 255, 50, 95, 185, 148, 213, 92, 16, 252, 64,
            172, 210, 211, 24, 55, 142, 141, 158, 118, 255, 64, 34, 114, 18, 56, 90, 250, 148, 188,
            98, 173, 143, 155, 52, 126, 19, 33, 186, 152, 245, 144, 57, 221, 28, 221, 248, 211,
            210, 160, 186, 157,
        ];
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(header("range", "bytes=16-50"))
            .respond_with(
                ResponseTemplate::new(206)
                    .insert_header("Content-Range", "bytes 16-50/59")
                    .set_body_bytes(encrypted[16..51].to_vec()),
            )
            .mount(&mock)
            .await;

        let file = crate::mega::MegaFile {
            name: "clip.mp4".into(),
            size: plaintext.len() as u64,
            download_url: format!("{}/dl", mock.uri()),
            key: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            nonce: [16, 17, 18, 19, 20, 21, 22, 23],
        };
        let link = crate::mega::MegaLink {
            handle: "testhandle".into(),
            key: "test".into(),
        };
        let server = LocalMediaServer::start().unwrap();
        let url = server.register_mega(crate::mega::MegaStream::new(
            reqwest::Client::new(),
            link,
            file,
        ));
        let response = reqwest::Client::new()
            .get(url)
            .header(reqwest::header::RANGE, "bytes=20-50")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers()[reqwest::header::CONTENT_RANGE],
            "bytes 20-50/59"
        );
        assert_eq!(response.bytes().await.unwrap().as_ref(), &plaintext[20..51]);
    }

    #[tokio::test]
    async fn supports_cache_validators() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clip.mp4");
        std::fs::write(&path, b"0123456789").unwrap();
        let server = LocalMediaServer::start().unwrap();
        let url = server.url_for(&path);
        let client = reqwest::Client::new();
        let response = client.get(&url).send().await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let etag = response.headers()[reqwest::header::ETAG]
            .to_str()
            .unwrap()
            .to_string();
        assert!(response
            .headers()
            .contains_key(reqwest::header::CACHE_CONTROL));

        let cached = client
            .get(&url)
            .header(reqwest::header::IF_NONE_MATCH, &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(cached.status(), reqwest::StatusCode::NOT_MODIFIED);

        let ranged = client
            .get(&url)
            .header(reqwest::header::RANGE, "bytes=0-3")
            .header(reqwest::header::IF_NONE_MATCH, &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(ranged.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(ranged.bytes().await.unwrap().as_ref(), b"0123");
    }

    #[test]
    fn maps_media_types() {
        assert_eq!(content_type(Path::new("cover.JPG")), "image/jpeg");
        assert_eq!(content_type(Path::new("clip.mp4")), "video/mp4");
        assert_eq!(content_type(Path::new("clip.MP3")), "audio/mpeg");
        assert_eq!(
            content_type(Path::new("clip.bin")),
            "application/octet-stream"
        );
    }
}
