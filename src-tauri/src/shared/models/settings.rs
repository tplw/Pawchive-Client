use super::creator::BlockedCreator;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub sidebar_visible: bool,
    pub volume: f64,
    pub playback_speed: f64,
    pub download_dir: String,
    pub hidden_keywords: Vec<String>,
    pub hide_ai_posts: bool,
    pub post_card_size: String,
    pub autoplay_next: bool,
    pub resume_playback: bool,
    pub reduce_motion: bool,
    pub accent_color: String,
    pub hide_no_media: bool,
    /// Hide posts the archive has not imported or that lost files to the
    /// archive size limit without a usable non-image attachment.
    pub hide_unavailable_posts: bool,
    pub auto_detect_asmr: bool,
    pub auto_sync_favorites: bool,
    pub cache_size_mb: u64,
    pub media_cache_size_mb: u64,
    pub cache_media: bool,
    pub transcode_media: bool,
    pub load_ahead_pages: u64,
    pub show_creator_updated: bool,
    pub auto_check_updates: bool,
    /// Latest release the user dismissed, so the update prompt only appears
    /// once per version.
    pub dismissed_update_version: String,
    /// Creators the user has blocked. Their posts and profiles are hidden from
    /// browsing, search and direct links.
    pub blocked_creators: Vec<BlockedCreator>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sidebar_visible: true,
            volume: 1.0,
            playback_speed: 1.0,
            download_dir: String::new(),
            hidden_keywords: Vec::new(),
            hide_ai_posts: false,
            post_card_size: if cfg!(any(target_os = "ios", target_os = "android")) {
                "small"
            } else {
                "medium"
            }
            .into(),
            autoplay_next: true,
            resume_playback: true,
            reduce_motion: false,
            accent_color: "#d6aea8".into(),
            hide_no_media: false,
            hide_unavailable_posts: false,
            auto_detect_asmr: true,
            auto_sync_favorites: false,
            cache_size_mb: 64,
            media_cache_size_mb: 512,
            cache_media: false,
            transcode_media: false,
            load_ahead_pages: 1,
            show_creator_updated: false,
            auto_check_updates: true,
            dismissed_update_version: String::new(),
            blocked_creators: Vec::new(),
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> Result<(), crate::shared::error::AppError> {
        use crate::shared::error::AppError;
        if !self.volume.is_finite() || !(0.0..=1.0).contains(&self.volume) {
            return Err(AppError::Validation(
                "volume must be between 0 and 1".into(),
            ));
        }
        if !self.playback_speed.is_finite() || !(0.25..=4.0).contains(&self.playback_speed) {
            return Err(AppError::Validation(
                "playback speed is out of range".into(),
            ));
        }
        if !matches!(self.post_card_size.as_str(), "small" | "medium" | "large") {
            return Err(AppError::Validation("invalid post card size".into()));
        }
        if !(8..=2048).contains(&self.cache_size_mb) {
            return Err(AppError::Validation(
                "cache size must be between 8 and 2048 MB".into(),
            ));
        }
        if !(64..=8192).contains(&self.media_cache_size_mb) {
            return Err(AppError::Validation(
                "media cache size must be between 64 and 8192 MB".into(),
            ));
        }
        if !(1..=5).contains(&self.load_ahead_pages) {
            return Err(AppError::Validation(
                "load-ahead pages must be between 1 and 5".into(),
            ));
        }
        if self.hidden_keywords.len() > 100 {
            return Err(AppError::Validation(
                "too many hidden keywords (max 100)".into(),
            ));
        }
        if self
            .hidden_keywords
            .iter()
            .any(|keyword| keyword.chars().count() > 80)
        {
            return Err(AppError::Validation(
                "each hidden keyword must be 80 characters or fewer".into(),
            ));
        }
        if self.blocked_creators.len() > 5000 {
            return Err(AppError::Validation(
                "too many blocked creators (max 5000)".into(),
            ));
        }
        if self.blocked_creators.iter().any(|creator| {
            creator.service.chars().count() > 40
                || creator.id.chars().count() > 200
                || creator.name.chars().count() > 300
        }) {
            return Err(AppError::Validation(
                "blocked creator details are too long".into(),
            ));
        }
        let accent = self.accent_color.as_bytes();
        if accent.len() != 7
            || accent[0] != b'#'
            || !accent[1..].iter().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::Validation(
                "accent color must be a hex color like #d6aea8".into(),
            ));
        }
        Ok(())
    }
}
