use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProgress {
    pub file_path: String,
    pub position: f64,
    pub duration: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub item_count: i64,
    pub cover_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: i64,
    pub playlist_id: i64,
    pub service: String,
    pub creator_id: String,
    pub post_id: String,
    pub media_path: String,
    pub media_url: String,
    pub title: String,
    pub creator_name: String,
    pub thumbnail_url: Option<String>,
    pub media_kind: String,
    pub added_at: i64,
    /// Local path of a completed download matching this item's media URL.
    #[serde(default)]
    pub local_path: Option<String>,
}
