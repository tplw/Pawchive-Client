use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::MediaKind;
use reqwest::StatusCode;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 512 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedMediaInfo {
    /// Loopback URL that streams the file with Range support.
    pub url: String,
    pub name: String,
    pub size: u64,
    pub kind: MediaKind,
    pub provider: crate::infra::providers::MediaProvider,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaDimensions {
    pub width: usize,
    pub height: usize,
}

/// Media resolution, size and dimension probing behind one feature seam.
/// Tauri commands stay thin wrappers around this service.
pub(crate) struct MediaService {
    state: AppState,
}

impl MediaService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    /// Turn a provider link into a loopback URL the webview can play.
    pub(crate) async fn resolve(&self, url: &str) -> AppResult<ResolvedMediaInfo> {
        if crate::infra::providers::mega::is_media_url(url) {
            let link = crate::infra::providers::mega::parse_file_link(url)
                .ok_or_else(|| AppError::Validation("not a MEGA file link".into()))?;
            let file = self.state.mega.resolve(url).await?;
            let stream = crate::infra::providers::mega::MegaStream::new(
                self.state.mega.client_clone(),
                link,
                file.clone(),
            );
            let local_url = self.state.media_server.register_mega(stream);
            return Ok(ResolvedMediaInfo {
                url: local_url,
                name: file.name.clone(),
                size: file.size,
                kind: file.kind(),
                provider: crate::infra::providers::MediaProvider::Mega,
            });
        }
        if crate::infra::providers::proton::is_proton_url(url) {
            let file = self.state.proton.resolve(url).await?;
            let stream = crate::infra::providers::proton::ProtonStream::new(file.clone());
            let local_url = self.state.media_server.register_proton(stream);
            return Ok(ResolvedMediaInfo {
                url: local_url,
                name: file.name.clone(),
                size: file.size,
                kind: file.kind,
                provider: crate::infra::providers::MediaProvider::Proton,
            });
        }
        let media = self.state.remote.resolve(url).await?;
        let source = media.source(self.state.remote.client().clone());
        let local_url = self.state.media_server.register_remote(source);
        Ok(ResolvedMediaInfo {
            url: local_url,
            name: media.name,
            size: media.size,
            kind: media.kind,
            provider: media.provider,
        })
    }

    /// Best-effort media size, first from provider metadata and then a HEAD or
    /// one-byte range request for direct URLs.
    pub(crate) async fn size(&self, url: &str) -> AppResult<Option<u64>> {
        if crate::infra::providers::mega::is_media_url(url) {
            return Ok(self
                .state
                .mega
                .resolve(url)
                .await
                .ok()
                .map(|file| file.size));
        }
        if crate::infra::providers::proton::is_proton_url(url) {
            return Ok(self
                .state
                .proton
                .resolve(url)
                .await
                .ok()
                .map(|file| file.size));
        }
        if crate::infra::providers::remote::needs_resolution(url) {
            return Ok(self
                .state
                .remote
                .resolve(url)
                .await
                .ok()
                .map(|media| media.size));
        }
        let url = crate::infra::media::validate_media_url(&self.state.cfg, url)?;
        if let Ok(Ok(response)) = tokio::time::timeout(
            Duration::from_secs(12),
            self.state
                .http
                .head(url.clone())
                .header(reqwest::header::REFERER, "https://pawchive.pw/")
                .send(),
        )
        .await
        {
            if response.status().is_success() {
                if let Some(length) = response.content_length() {
                    return Ok(Some(length));
                }
            }
        }

        let response = tokio::time::timeout(
            Duration::from_secs(12),
            self.state
                .http
                .get(url)
                .header(reqwest::header::RANGE, "bytes=0-0")
                .header(reqwest::header::REFERER, "https://pawchive.pw/")
                .send(),
        )
        .await
        .map_err(|_| AppError::Network("media size request timed out".into()))?
        .map_err(|error| {
            AppError::Network(crate::shared::security::network_error_message(&error))
        })?;
        if !response.status().is_success() && response.status() != StatusCode::PARTIAL_CONTENT {
            return Ok(None);
        }
        let total = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit('/').next())
            .and_then(|value| value.parse::<u64>().ok());
        Ok(total.or_else(|| response.content_length()))
    }

    /// Read just enough of an image to detect its dimensions.
    pub(crate) async fn image_dimensions(&self, url: &str) -> AppResult<Option<MediaDimensions>> {
        if crate::infra::providers::proton::is_proton_url(url) {
            let file = self.state.proton.resolve(url).await?;
            let bytes = self
                .state
                .proton
                .read_range(&file, 0, MAX_HEADER_BYTES as u64)
                .await?;
            return Ok(imagesize::blob_size(&bytes)
                .ok()
                .map(|size| MediaDimensions {
                    width: size.width,
                    height: size.height,
                }));
        }
        let (url, extra_headers) = if crate::infra::providers::remote::needs_resolution(url) {
            let media = self.state.remote.resolve(url).await?;
            (media.url, media.headers)
        } else {
            (
                crate::infra::media::validate_media_url(&self.state.cfg, url)?.to_string(),
                Vec::new(),
            )
        };
        let mut request = self
            .state
            .http
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-524287")
            .header(reqwest::header::REFERER, "https://pawchive.pw/");
        for (name, value) in extra_headers {
            request = request.header(name, value);
        }
        let response = tokio::time::timeout(Duration::from_secs(12), request.send())
            .await
            .map_err(|_| AppError::Network("image dimensions request timed out".into()))?
            .map_err(|error| {
                AppError::Network(crate::shared::security::network_error_message(&error))
            })?;
        if !response.status().is_success() && response.status() != StatusCode::PARTIAL_CONTENT {
            return Ok(None);
        }
        let mut bytes = Vec::with_capacity(MAX_HEADER_BYTES);
        let mut response = response;
        while bytes.len() < MAX_HEADER_BYTES {
            let chunk = tokio::time::timeout(Duration::from_secs(12), response.chunk())
                .await
                .map_err(|_| AppError::Timeout)?
                .map_err(|error| {
                    AppError::Network(crate::shared::security::network_error_message(&error))
                })?;
            let Some(chunk) = chunk else {
                break;
            };
            let remaining = MAX_HEADER_BYTES.saturating_sub(bytes.len());
            bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }
        let Ok(size) = imagesize::blob_size(&bytes) else {
            return Ok(None);
        };
        Ok(Some(MediaDimensions {
            width: size.width,
            height: size.height,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolved_media_info_keeps_the_ipc_shape() {
        let info = ResolvedMediaInfo {
            url: "http://127.0.0.1:1/media/token".into(),
            name: "clip.mp4".into(),
            size: 42,
            kind: MediaKind::Video,
            provider: crate::infra::providers::MediaProvider::Mega,
        };
        let json = serde_json::to_value(info).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "url": "http://127.0.0.1:1/media/token",
                "name": "clip.mp4",
                "size": 42,
                "kind": "video",
                "provider": "mega"
            })
        );
    }

    #[test]
    fn media_dimensions_keep_the_ipc_shape() {
        let json = serde_json::to_value(MediaDimensions {
            width: 640,
            height: 480,
        })
        .unwrap();
        assert_eq!(json, serde_json::json!({ "width": 640, "height": 480 }));
    }
}
