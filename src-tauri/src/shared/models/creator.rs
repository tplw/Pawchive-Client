use super::common::{flex_ts, string_or_default};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CreatorSummary {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default)]
    pub public_id: Option<String>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub indexed: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub updated: Option<i64>,
    /// Number of archive users who favourited this creator. The API exposes it
    /// as a popularity signal; it is not local state.
    #[serde(default)]
    pub favorited: Option<i64>,
    /// Whether the local user has starred this creator.
    #[serde(default)]
    pub is_favorite: bool,
    /// The archive relays creator metadata before any of their posts have been
    /// imported. `None` means the archive did not report the field, which we
    /// treat as imported so older data never shows a false warning.
    #[serde(default)]
    pub ever_imported: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct CreatorProfile {
    #[serde(default, deserialize_with = "string_or_default")]
    pub id: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub name: String,
    #[serde(default, deserialize_with = "string_or_default")]
    pub service: String,
    #[serde(default)]
    pub public_id: Option<String>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub indexed: Option<i64>,
    #[serde(default, deserialize_with = "flex_ts")]
    pub updated: Option<i64>,
    #[serde(default)]
    pub relation_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    /// Whether the archive has ever imported this creator. Mirrors
    /// `CreatorSummary::ever_imported`.
    #[serde(default)]
    pub ever_imported: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedCreator {
    pub service: String,
    pub id: String,
    pub name: String,
}
