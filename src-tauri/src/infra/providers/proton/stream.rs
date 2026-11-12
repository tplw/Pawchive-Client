use super::{map_error, ProtonFile, ProtonResolver};
use crate::shared::error::{AppError, AppResult};
use proton_drive_rs::RevisionReader;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio_util::sync::CancellationToken;

/// One range read is capped so a seek does not allocate the whole video.
const READ_CHUNK: u64 = 1024 * 1024;

/// A registered Proton source that the loopback media server can stream.
///
/// The revision reader is pinned to the revision that was active when the
/// player first opened the file. It is shared by every range request for the
/// same loopback token, so seeking does not repeat the share handshake.
#[derive(Clone)]
pub struct ProtonStream {
    pub file: ProtonFile,
}

impl ProtonStream {
    pub fn new(file: ProtonFile) -> Self {
        Self { file }
    }

    /// Open the active revision once and reuse it for all ranges.
    pub async fn reader(&self) -> AppResult<Arc<RevisionReader>> {
        self.file.reader().await
    }

    pub async fn read_at(&self, offset: u64, length: u64) -> AppResult<Vec<u8>> {
        self.reader()
            .await?
            .read_at(offset, length)
            .await
            .map_err(map_error)
    }
}

/// Download and decrypt a Proton file to disk. Used by the download queue,
/// the media cache fallback and the transcoder.
pub async fn download_to_path<F>(
    resolver: &ProtonResolver,
    raw_url: &str,
    path: &Path,
    max_bytes: u64,
    token: Option<&CancellationToken>,
    mut progress: F,
) -> AppResult<(ProtonFile, u64)>
where
    F: FnMut(u64, Option<u64>),
{
    let file = resolver.resolve(raw_url).await?;
    if file.size > max_bytes {
        return Err(AppError::Validation(
            "the Proton Drive file exceeds the size limit".into(),
        ));
    }
    let output = tokio::fs::File::create(path)
        .await
        .map_err(|error| AppError::Io(format!("could not create Proton Drive file: {error}")))?;
    let mut output = BufWriter::with_capacity(1024 * 1024, output);
    progress(0, Some(file.size));
    if file.size == 0 {
        output
            .flush()
            .await
            .map_err(|error| AppError::Io(format!("could not flush Proton Drive file: {error}")))?;
        return Ok((file, 0));
    }

    let reader = file.reader().await?;
    let block_sizes = reader.block_sizes().to_vec();
    let mut downloaded = 0u64;
    let mut block_index = 0usize;
    while downloaded < file.size {
        let length = block_sizes
            .get(block_index)
            .copied()
            .unwrap_or(READ_CHUNK)
            .min(file.size - downloaded);
        let next = if let Some(token) = token {
            tokio::select! {
                _ = token.cancelled() => return Err(AppError::Cancelled),
                next = reader.read_at(downloaded, length) => next,
            }
        } else {
            reader.read_at(downloaded, length).await
        };
        let chunk = next.map_err(map_error)?;
        if chunk.len() as u64 != length {
            return Err(AppError::Unavailable(
                "Proton Drive ended the download before the file was complete".into(),
            ));
        }
        downloaded += chunk.len() as u64;
        if downloaded > max_bytes {
            return Err(AppError::Validation(
                "the Proton Drive file exceeds the size limit".into(),
            ));
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|error| AppError::Io(format!("could not write Proton Drive file: {error}")))?;
        progress(downloaded, Some(file.size));
        block_index += 1;
    }
    output
        .flush()
        .await
        .map_err(|error| AppError::Io(format!("could not flush Proton Drive file: {error}")))?;
    Ok((file, downloaded))
}
