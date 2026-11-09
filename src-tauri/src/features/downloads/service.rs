use crate::error::{AppError, AppResult};
use crate::features::posts::summary::{
    mark_thumbnail_attempted, post_thumbnail, thumbnail_attempted,
};
use crate::models::{DownloadRecord, DownloadRequest};
use crate::shared::task::blocking;
use crate::state::AppState;
use std::sync::Arc;
use tauri::AppHandle;

/// Download queue commands and download-list thumbnail enrichment.
pub(crate) struct DownloadService {
    state: AppState,
}

impl DownloadService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn start(
        &self,
        app: &AppHandle,
        request: DownloadRequest,
    ) -> AppResult<DownloadRecord> {
        crate::downloads::enqueue(&self.state, app, request).await
    }

    pub(crate) async fn download_post(
        &self,
        app: &AppHandle,
        service: &str,
        creator_id: &str,
        post_id: &str,
    ) -> AppResult<u64> {
        crate::downloads::download_post(&self.state, app, service, creator_id, post_id).await
    }

    pub(crate) async fn download_playlist(
        &self,
        app: &AppHandle,
        playlist_id: i64,
    ) -> AppResult<u64> {
        crate::downloads::download_playlist(&self.state, app, playlist_id).await
    }

    pub(crate) async fn cancel(&self, id: &str) -> AppResult<()> {
        crate::downloads::cancel(&self.state, id).await
    }

    pub(crate) async fn delete(&self, id: &str) -> AppResult<()> {
        crate::downloads::delete(&self.state, id).await
    }

    pub(crate) async fn retry(&self, app: &AppHandle, id: &str) -> AppResult<DownloadRecord> {
        crate::downloads::retry(&self.state, app, id).await
    }

    pub(crate) async fn clear_completed(&self) -> AppResult<u64> {
        crate::downloads::clear_completed(&self.state).await
    }

    pub(crate) async fn clear_all(&self) -> AppResult<u64> {
        crate::downloads::clear_all(&self.state).await
    }

    pub(crate) async fn list(&self) -> AppResult<Vec<DownloadRecord>> {
        let download_dir = self.state.download_dir();
        let db = Arc::clone(&self.state.db);
        let mut records = blocking(move || {
            let mut records = db.list_downloads()?;
            for record in &mut records {
                let original = std::path::Path::new(&record.file_path);
                if original.exists() {
                    continue;
                }
                if let Some(name) = original.file_name() {
                    let candidate = download_dir.join(name);
                    if candidate.exists() {
                        record.file_path = candidate.to_string_lossy().to_string();
                    }
                }
            }
            Ok(records)
        })
        .await?;

        let pending: Vec<DownloadRecord> = records
            .iter()
            .filter(|record| {
                record.thumbnail_url.is_none()
                    && (record.media_kind == "video" || record.media_kind == "audio")
                    && !thumbnail_attempted(&record.id)
            })
            .take(8)
            .cloned()
            .collect();
        for record in pending {
            mark_thumbnail_attempted(&record.id);
            if let Ok(post) = self
                .state
                .api
                .post(&record.service, &record.creator_id, &record.post_id, None)
                .await
            {
                if let Some(thumbnail) = post_thumbnail(&self.state, &post) {
                    let _ = self.state.db.set_download_thumbnail(&record.id, &thumbnail);
                    if let Some(target) = records.iter_mut().find(|entry| entry.id == record.id) {
                        target.thumbnail_url = Some(thumbnail);
                    }
                }
            }
        }
        Ok(records)
    }

    pub(crate) fn open_folder(&self) -> AppResult<()> {
        let dir = self.state.download_dir();
        std::fs::create_dir_all(&dir)?;
        tauri_plugin_opener::open_path(dir, None::<&str>)
            .map_err(|e| AppError::Io(format!("could not open downloads folder: {e}")))
    }
}
