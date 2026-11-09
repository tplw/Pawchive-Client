use super::crypto::{ctr_cipher, AesCtr};
use super::links::{MegaFile, MegaLink};
use super::resolver::{fetch_file, MegaResolver};
use crate::shared::error::{AppError, AppResult};
use aes::cipher::StreamCipher;
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

const READ_TIMEOUT: Duration = Duration::from_secs(60);

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
            .map_err(|error| {
                AppError::Network(crate::shared::security::network_error_message(&error))
            })?;
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
                    AppError::Network(crate::shared::security::network_error_message(&error))
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
