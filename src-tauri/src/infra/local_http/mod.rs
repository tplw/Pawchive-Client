mod mime;
mod range;

use mime::content_type;
use range::{is_not_modified, parse_range};

pub use mime::content_type_for_name;

use crate::shared::error::{AppError, AppResult};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// An external provider stream proxied through the loopback server. Proxying
/// gives the webview a stable HTTPS-free localhost URL with Range support even
/// when the provider requires cookies, a specific user agent or redirects.
#[derive(Clone)]
pub struct RemoteSource {
    pub client: reqwest::Client,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub size: u64,
    pub content_type: String,
    pub etag: String,
}

#[derive(Clone)]
enum MediaSource {
    File(PathBuf),
    Mega(Arc<crate::infra::providers::mega::MegaStream>),
    Remote(Arc<RemoteSource>),
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
    pub fn register_mega(&self, stream: crate::infra::providers::mega::MegaStream) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(token.clone(), MediaSource::Mega(Arc::new(stream)));
        }
        format!("{}/media/{token}", self.base_url)
    }

    /// Register an external provider stream (Google Drive, Dropbox, GoFile).
    pub fn register_remote(&self, source: RemoteSource) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(token.clone(), MediaSource::Remote(Arc::new(source)));
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
        MediaSource::Remote(source) => serve_remote(socket, request, &method, source).await,
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
    stream: Arc<crate::infra::providers::mega::MegaStream>,
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

async fn serve_remote(
    mut socket: TcpStream,
    request: String,
    method: &str,
    source: Arc<RemoteSource>,
) -> std::io::Result<()> {
    let length = source.size;
    let etag = source.etag.as_str();
    if is_not_modified(&request, etag) {
        return respond_not_modified(&mut socket, etag).await;
    }

    let range = parse_range(&request, length);
    let (status, start, end) = match range {
        Some((start, end)) => ("206 Partial Content", start, end),
        None => ("200 OK", 0, length.saturating_sub(1)),
    };
    let body_length = if length == 0 {
        0
    } else {
        end.saturating_sub(start) + 1
    };
    let range_header = if length == 0 {
        None
    } else {
        Some((start, end, length))
    };

    // HEAD is answered from the metadata probe, so opening the player never
    // waits on the provider twice.
    if method == "HEAD" {
        return write_media_headers(
            &mut socket,
            status,
            &source.content_type,
            body_length,
            etag,
            range_header,
        )
        .await;
    }

    let mut upstream = source
        .client
        .get(&source.url)
        .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in &source.headers {
        upstream = upstream.header(name, value);
    }
    let response = match tokio::time::timeout(Duration::from_secs(30), upstream.send()).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            tracing::warn!(%error, "remote media request failed");
            return respond_status(
                &mut socket,
                "502 Bad Gateway",
                "media provider is unavailable",
            )
            .await;
        }
        Err(_) => {
            return respond_status(
                &mut socket,
                "504 Gateway Timeout",
                "media provider timed out",
            )
            .await
        }
    };
    let upstream_status = response.status();
    if upstream_status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let response = format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{length}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        return socket.write_all(response.as_bytes()).await;
    }
    if !upstream_status.is_success() && upstream_status != reqwest::StatusCode::PARTIAL_CONTENT {
        tracing::warn!(
            status = upstream_status.as_u16(),
            "remote media provider rejected the range"
        );
        return respond_status(
            &mut socket,
            "502 Bad Gateway",
            "media provider did not return the file",
        )
        .await;
    }

    write_media_headers(
        &mut socket,
        status,
        &source.content_type,
        body_length,
        etag,
        range_header,
    )
    .await?;

    // Some providers ignore Range on the first request and answer 200 with
    // the whole file. Skip to the requested offset so seeking still works.
    let skip = if upstream_status == reqwest::StatusCode::OK {
        start
    } else {
        0
    };
    stream_remote_body(socket, response, skip, body_length).await
}

async fn stream_remote_body(
    mut socket: TcpStream,
    mut response: reqwest::Response,
    mut skip: u64,
    mut remaining: u64,
) -> std::io::Result<()> {
    while remaining > 0 {
        let chunk = match tokio::time::timeout(Duration::from_secs(60), response.chunk()).await {
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                tracing::warn!(%error, "remote media stream was interrupted");
                break;
            }
            Err(_) => {
                tracing::warn!("remote media stream timed out");
                break;
            }
        };
        let mut offset = 0usize;
        if skip > 0 {
            if chunk.len() as u64 <= skip {
                skip -= chunk.len() as u64;
                continue;
            }
            offset = skip as usize;
            skip = 0;
        }
        let available = &chunk[offset..];
        let take = available.len().min(remaining as usize);
        socket.write_all(&available[..take]).await?;
        remaining -= take as u64;
        if take < available.len() {
            break;
        }
    }
    Ok(())
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

        let file = crate::infra::providers::mega::MegaFile {
            name: "clip.mp4".into(),
            size: plaintext.len() as u64,
            download_url: format!("{}/dl", mock.uri()),
            key: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            nonce: [16, 17, 18, 19, 20, 21, 22, 23],
        };
        let link = crate::infra::providers::mega::MegaLink {
            handle: "testhandle".into(),
            key: "test".into(),
        };
        let server = LocalMediaServer::start().unwrap();
        let url = server.register_mega(crate::infra::providers::mega::MegaStream::new(
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

    #[tokio::test]
    async fn proxies_a_remote_range() {
        use wiremock::matchers::{header, method};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(header("range", "bytes=2-5"))
            .respond_with(
                ResponseTemplate::new(206)
                    .insert_header("Content-Range", "bytes 2-5/10")
                    .set_body_bytes(b"2345".to_vec()),
            )
            .mount(&mock)
            .await;
        let server = LocalMediaServer::start().unwrap();
        let url = server.register_remote(RemoteSource {
            client: reqwest::Client::new(),
            url: format!("{}/file", mock.uri()),
            headers: Vec::new(),
            size: 10,
            content_type: "video/mp4".into(),
            etag: "\"remote-test\"".into(),
        });
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
        assert_eq!(
            response.headers()[reqwest::header::CONTENT_TYPE],
            "video/mp4"
        );
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"2345");
    }

    #[tokio::test]
    async fn skips_upstream_body_when_a_provider_ignores_ranges() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"0123456789".to_vec()))
            .mount(&mock)
            .await;
        let server = LocalMediaServer::start().unwrap();
        let url = server.register_remote(RemoteSource {
            client: reqwest::Client::new(),
            url: format!("{}/file", mock.uri()),
            headers: Vec::new(),
            size: 10,
            content_type: "video/mp4".into(),
            etag: "\"remote-test\"".into(),
        });
        let response = reqwest::Client::new()
            .get(url)
            .header(reqwest::header::RANGE, "bytes=2-5")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.bytes().await.unwrap().as_ref(), b"2345");
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
