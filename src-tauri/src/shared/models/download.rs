use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub file_name: String,
    pub media_kind: String,
    pub title: String,
    pub creator_name: String,
    pub service: String,
    pub creator_id: String,
    pub post_id: String,
    pub playlist_id: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub total_bytes: Option<i64>,
    pub downloaded_bytes: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub creator_name: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub creator_id: String,
    #[serde(default)]
    pub post_id: String,
    #[serde(default)]
    pub playlist_id: Option<i64>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub media_kind: String,
}
