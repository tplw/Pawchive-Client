use crate::app::state::AppState;
use crate::features::posts::summary::{
    mark_thumbnail_attempted, post_thumbnail, thumbnail_attempted,
};
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{now_ts, CreatorSummary, Playlist, PlaylistItem};
use crate::shared::security::{validate_id, validate_service};
use crate::shared::task::blocking;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A playlist item is offline only when the recorded completed file still
/// exists as a non-empty regular file. Stale database rows must not produce a
/// false offline indicator.
fn existing_local_path(local: &str, download_dir: &Path) -> Option<PathBuf> {
    let valid = |path: &Path| {
        path.is_file()
            && std::fs::metadata(path)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false)
    };
    let original = Path::new(local);
    let mut candidates = Vec::new();
    if let Some(name) = original.file_name() {
        // Flat downloads and creator batch downloads use different levels.
        candidates.push(download_dir.join(name));
        if let Some(parent) = original.parent().and_then(Path::file_name) {
            candidates.push(download_dir.join(parent).join(name));
        }
    }
    candidates.push(original.to_path_buf());
    candidates.into_iter().find(|path| valid(path))
}

/// Playlists and creator favorites.
pub(crate) struct LibraryService {
    state: AppState,
}

impl LibraryService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn list_playlists(&self) -> AppResult<Vec<Playlist>> {
        let db = Arc::clone(&self.state.db);
        blocking(move || db.list_playlists()).await
    }

    pub(crate) async fn get_playlist(&self, id: i64) -> AppResult<Playlist> {
        let db = Arc::clone(&self.state.db);
        blocking(move || db.get_playlist(id))
            .await?
            .ok_or(AppError::NotFound)
    }

    pub(crate) async fn create_playlist(
        &self,
        name: String,
        description: Option<String>,
    ) -> AppResult<Playlist> {
        let description = description.unwrap_or_default();
        let db = Arc::clone(&self.state.db);
        blocking(move || db.create_playlist(&name, &description)).await
    }

    pub(crate) async fn rename_playlist(
        &self,
        id: i64,
        name: String,
        description: Option<String>,
    ) -> AppResult<()> {
        let description = description.unwrap_or_default();
        let db = Arc::clone(&self.state.db);
        blocking(move || db.rename_playlist(id, &name, &description)).await
    }

    pub(crate) async fn delete_playlist(&self, id: i64) -> AppResult<()> {
        let db = Arc::clone(&self.state.db);
        blocking(move || db.delete_playlist(id)).await
    }

    pub(crate) async fn list_playlist_items(
        &self,
        playlist_id: i64,
    ) -> AppResult<Vec<PlaylistItem>> {
        let download_dir = self.state.download_dir();
        let db = Arc::clone(&self.state.db);
        let mut items = blocking(move || {
            let mut items = db.list_playlist_items(playlist_id)?;
            for item in &mut items {
                if let Some(local) = item.local_path.take() {
                    // App containers can move between installs on iOS. Prefer
                    // the current download folder when the recorded absolute
                    // path is stale, falling back to the original path if it
                    // still exists.
                    item.local_path = existing_local_path(&local, &download_dir)
                        .map(|path| path.to_string_lossy().to_string());
                }
            }
            Ok(items)
        })
        .await?;

        for item in &mut items {
            if item.thumbnail_url.is_some() {
                continue;
            }
            if item.media_kind == "image" {
                item.thumbnail_url = Some(item.media_url.clone());
                let _ = self
                    .state
                    .db
                    .set_playlist_item_thumbnail(item.id, &item.media_url);
                continue;
            }
            if item.media_kind == "video" || item.media_kind == "audio" {
                let attempt_key = format!("playlist-item:{}", item.id);
                if thumbnail_attempted(&attempt_key) {
                    continue;
                }
                mark_thumbnail_attempted(&attempt_key);
                if let Ok(post) = self
                    .state
                    .api
                    .post(&item.service, &item.creator_id, &item.post_id, None)
                    .await
                {
                    if let Some(thumbnail) = post_thumbnail(&self.state, &post) {
                        item.thumbnail_url = Some(thumbnail.clone());
                        let _ = self
                            .state
                            .db
                            .set_playlist_item_thumbnail(item.id, &thumbnail);
                    }
                }
            }
        }
        Ok(items)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn add_playlist_item(
        &self,
        playlist_id: i64,
        service: String,
        creator_id: String,
        post_id: String,
        media_path: String,
        media_url: String,
        title: String,
        creator_name: String,
        thumbnail_url: Option<String>,
        media_kind: String,
    ) -> AppResult<PlaylistItem> {
        crate::infra::media::validate_media_url(&self.state.cfg, &media_url)?;
        let item = PlaylistItem {
            id: 0,
            playlist_id,
            service,
            creator_id,
            post_id,
            media_path,
            media_url,
            title,
            creator_name,
            thumbnail_url,
            media_kind,
            added_at: now_ts(),
            local_path: None,
        };
        let db = Arc::clone(&self.state.db);
        blocking(move || db.add_playlist_item(playlist_id, &item)).await
    }

    pub(crate) async fn remove_playlist_item(&self, id: i64) -> AppResult<()> {
        let db = Arc::clone(&self.state.db);
        blocking(move || db.remove_playlist_item(id)).await
    }

    pub(crate) async fn reorder_playlist_items(
        &self,
        playlist_id: i64,
        item_ids: Vec<i64>,
    ) -> AppResult<()> {
        let db = Arc::clone(&self.state.db);
        blocking(move || db.reorder_playlist_items(playlist_id, &item_ids)).await
    }

    pub(crate) async fn favorite_creators(&self) -> AppResult<Vec<CreatorSummary>> {
        let settings = self.state.settings();
        let db = Arc::clone(&self.state.db);
        let items = blocking(move || db.list_favorite_creators()).await?;
        Ok(items
            .into_iter()
            .filter(|creator| {
                !crate::features::posts::filters::is_creator_blocked(
                    &creator.service,
                    &creator.id,
                    &settings,
                )
            })
            .collect())
    }

    pub(crate) async fn set_favorite_creator(
        &self,
        service: String,
        creator_id: String,
        name: String,
        public_id: Option<String>,
        favorited: bool,
    ) -> AppResult<bool> {
        let service = validate_service(&service)?;
        let creator_id = validate_id(&creator_id, "creator id")?;
        let db = Arc::clone(&self.state.db);
        let (s, id, n, p) = (
            service.clone(),
            creator_id.clone(),
            name.clone(),
            public_id.clone(),
        );
        blocking(move || db.set_favorite_creator(&s, &id, &n, p.as_deref(), favorited)).await?;
        if self.state.account_session().is_some() {
            if let Err(error) = self
                .state
                .api
                .set_account_favorite_creator(&service, &creator_id, favorited)
                .await
            {
                tracing::warn!(%error, "could not sync favorite with the account");
            }
        }
        Ok(favorited)
    }
}

#[cfg(test)]
mod tests {
    use super::existing_local_path;
    use std::fs;

    #[test]
    fn only_existing_non_empty_files_count_as_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("clip.mp4");
        fs::write(&file, b"media").unwrap();

        let moved = existing_local_path("/old/Downloads/clip.mp4", dir.path());
        assert_eq!(moved.as_deref(), Some(file.as_path()));

        let direct = existing_local_path(file.to_str().unwrap(), &dir.path().join("other"));
        assert_eq!(direct.as_deref(), Some(file.as_path()));

        let creator_dir = dir.path().join("Ada");
        fs::create_dir(&creator_dir).unwrap();
        let creator_file = creator_dir.join("batch.mp4");
        fs::write(&creator_file, b"media").unwrap();
        assert_eq!(
            existing_local_path("/old/Documents/Ada/batch.mp4", dir.path()).as_deref(),
            Some(creator_file.as_path())
        );

        assert!(existing_local_path("/old/Downloads/missing.mp4", dir.path()).is_none());

        fs::write(dir.path().join("empty.mp4"), b"").unwrap();
        assert!(existing_local_path("/old/Downloads/empty.mp4", dir.path()).is_none());

        fs::create_dir(dir.path().join("folder.mp4")).unwrap();
        assert!(existing_local_path("/old/Downloads/folder.mp4", dir.path()).is_none());
    }
}
