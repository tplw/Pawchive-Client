use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{now_ts, Announcement, CreatorPage, CreatorProfile, CreatorSummary};
use crate::shared::security::{sanitize_html, validate_id, validate_service};
use crate::shared::task::blocking;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Creator index, profile metadata and similarity lookups.
pub(crate) struct CreatorService {
    state: AppState,
}

impl CreatorService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn sync(&self, app: &AppHandle, request_id: Option<&str>) -> AppResult<i64> {
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self.state.api.list_creators(token.as_ref()).await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        let creators = result?;
        if creators.is_empty() {
            return Err(AppError::InvalidResponse(
                "the archive returned an empty creator index".into(),
            ));
        }
        let db = Arc::clone(&self.state.db);
        let count = blocking(move || db.sync_creators(&creators)).await?;
        self.state
            .db
            .set_raw_setting("creators_synced_at", &now_ts().to_string())?;
        self.state
            .db
            .set_raw_setting("creators_import_state_synced", "1")?;
        let _ = app.emit("creators://synced", count);
        Ok(count as i64)
    }

    pub(crate) async fn count(&self) -> AppResult<i64> {
        // Creator rows that predate import-state tracking were migrated with
        // `ever_imported = 1`. Force one refresh so cards stop treating
        // archived and unimported creators the same.
        if self
            .state
            .db
            .get_raw_setting("creators_import_state_synced")?
            .is_none()
        {
            return Ok(0);
        }
        let db = Arc::clone(&self.state.db);
        let count = blocking(move || db.creator_count()).await?;
        tracing::debug!(count, "creator index count requested");
        Ok(count)
    }

    pub(crate) async fn list(
        &self,
        query: String,
        service: Option<String>,
        sort: Option<String>,
        offset: Option<i64>,
        limit: Option<i64>,
    ) -> AppResult<CreatorPage> {
        let sort = sort.unwrap_or_else(|| "updated".into());
        let offset = offset.unwrap_or(0).max(0);
        let limit = limit.unwrap_or(60).clamp(1, 200);
        let service = service.filter(|s| !s.trim().is_empty());
        if let Some(service) = service.as_deref() {
            validate_service(service)?;
        }
        let db = Arc::clone(&self.state.db);
        let (items, total) =
            blocking(move || db.query_creators(&query, service.as_deref(), &sort, offset, limit))
                .await?;
        let settings = self.state.settings();
        let items: Vec<_> = items
            .into_iter()
            .filter(|creator| {
                !crate::features::posts::filters::is_creator_blocked(
                    &creator.service,
                    &creator.id,
                    &settings,
                )
            })
            .collect();
        Ok(CreatorPage {
            items,
            offset,
            total,
            has_more: offset + limit < total,
            synced: total > 0,
        })
    }

    pub(crate) async fn get(
        &self,
        service: &str,
        creator_id: &str,
    ) -> AppResult<Option<CreatorSummary>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        if crate::features::posts::filters::is_creator_blocked(
            &service,
            &creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let db = Arc::clone(&self.state.db);
        blocking(move || db.get_creator(&service, &creator_id)).await
    }

    pub(crate) async fn profile(
        &self,
        service: &str,
        creator_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<CreatorProfile> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .creator_profile(service, creator_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        result
    }

    pub(crate) async fn links(
        &self,
        service: &str,
        creator_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<Vec<CreatorProfile>> {
        let settings = self.state.settings();
        if crate::features::posts::filters::is_creator_blocked(service, creator_id, &settings) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .creator_links(service, creator_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        Ok(result?
            .into_iter()
            .filter(|item| {
                !crate::features::posts::filters::is_creator_blocked(
                    &item.service,
                    &item.id,
                    &settings,
                )
            })
            .collect())
    }

    pub(crate) async fn announcements(
        &self,
        service: &str,
        creator_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<Vec<Announcement>> {
        if crate::features::posts::filters::is_creator_blocked(
            service,
            creator_id,
            &self.state.settings(),
        ) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .announcements(service, creator_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        Ok(result?
            .into_iter()
            .map(|mut item| {
                item.content = sanitize_html(&item.content);
                item
            })
            .collect())
    }

    pub(crate) async fn similar(
        &self,
        service: &str,
        creator_id: &str,
        request_id: Option<&str>,
    ) -> AppResult<Vec<CreatorSummary>> {
        let settings = self.state.settings();
        if crate::features::posts::filters::is_creator_blocked(service, creator_id, &settings) {
            return Err(AppError::Blocked);
        }
        let token = request_id.map(|id| self.state.register_cancel(id));
        let result = self
            .state
            .api
            .similar_creators_html(service, creator_id, token.as_ref())
            .await;
        if let Some(id) = request_id {
            self.state.finish_cancel(id);
        }
        let items = crate::features::creators::similar::parse_similar_creators(&result?);
        let hide_unavailable = settings.hide_unavailable_posts;
        let db = Arc::clone(&self.state.db);
        blocking(move || {
            Ok(items
                .into_iter()
                .map(|item| {
                    db.get_creator(&item.service, &item.id)
                        .ok()
                        .flatten()
                        .unwrap_or(item)
                })
                .filter(|item| {
                    !crate::features::posts::filters::is_creator_blocked(
                        &item.service,
                        &item.id,
                        &settings,
                    ) && (!hide_unavailable || item.ever_imported != Some(false))
                })
                .collect())
        })
        .await
    }
}
