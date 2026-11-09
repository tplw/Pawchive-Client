use crate::error::AppResult;
use crate::models::AppSettings;
use crate::shared::task::blocking;
use crate::state::AppState;
use std::sync::Arc;

/// Application settings persistence and in-memory state.
pub(crate) struct SettingsService {
    state: AppState,
}

impl SettingsService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) fn current(&self) -> AppSettings {
        self.state.settings()
    }

    pub(crate) async fn save(&self, mut settings: AppSettings) -> AppResult<AppSettings> {
        let mut seen = std::collections::HashSet::new();
        settings.hidden_keywords = settings
            .hidden_keywords
            .into_iter()
            .map(|keyword| keyword.trim().to_string())
            .filter(|keyword| !keyword.is_empty())
            .filter(|keyword| seen.insert(keyword.to_lowercase()))
            .take(100)
            .collect();
        settings.validate()?;
        let saved = settings.clone();
        let db = Arc::clone(&self.state.db);
        blocking(move || db.save_settings(&saved)).await?;
        self.state.api.set_cache_size_mb(settings.cache_size_mb);
        if let Ok(mut current) = self.state.settings.write() {
            *current = settings.clone();
        }
        Ok(settings)
    }
}
