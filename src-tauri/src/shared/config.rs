use serde::{Deserialize, Serialize};

/// Central configuration for every remote Pawchive service.
///
/// All defaults come from the published API documentation. They are gathered
/// here so a backend change never requires edits scattered across the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PawchiveConfig {
    pub api_base: String,
    pub static_base: String,
    pub image_base: String,
    pub file_base: String,
    pub app_name: String,
    pub app_version: String,
    pub user_agent: String,
    pub default_timeout_secs: u64,
    pub default_concurrency: usize,
    pub default_retries: u32,
    pub cache_ttl_secs: u64,
    pub page_size: i64,
}

impl Default for PawchiveConfig {
    fn default() -> Self {
        Self {
            api_base: "https://pawchive.pw/api/v1".to_string(),
            static_base: "https://pawchive.pw".to_string(),
            image_base: "https://img.pawchive.pw".to_string(),
            file_base: "https://file.pawchive.pw/data".to_string(),
            app_name: "Pawchive".to_string(),
            app_version: crate::shared::version::APP_VERSION.to_string(),
            user_agent: format!(
                "PawchiveClient/{} (+https://pawchive.pw)",
                crate::shared::version::APP_VERSION
            ),
            default_timeout_secs: 30,
            default_concurrency: 8,
            default_retries: 3,
            cache_ttl_secs: 300,
            page_size: 50,
        }
    }
}

impl PawchiveConfig {
    /// Hosts the application is allowed to contact. Creator icons, banners and
    /// thumbnails live on the static/image hosts; media lives on the file host.
    pub fn allowed_hosts(&self) -> Vec<String> {
        let mut hosts = Vec::new();
        for base in [
            &self.api_base,
            &self.static_base,
            &self.image_base,
            &self.file_base,
        ] {
            if let Ok(url) = url::Url::parse(base) {
                if let Some(host) = url.host_str() {
                    hosts.push(host.to_ascii_lowercase());
                }
            }
        }
        hosts.sort();
        hosts.dedup();
        hosts
    }

    pub fn api_url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.api_base.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    pub fn file_url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.file_base.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    pub fn thumbnail_url(&self, path: &str) -> String {
        format!(
            "{}/thumbnail/data/{}",
            self.image_base.trim_end_matches('/'),
            thumbnail_path(path)
        )
    }
}

/// Archive file paths sometimes carry a one-character storage prefix in their
/// first shard (`/25f/c7/...`). The thumbnail host stores the same object
/// without that prefix (`/5f/c7/...`). Paths that already start with a plain
/// two-character shard are unchanged.
fn thumbnail_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    let mut segments = trimmed.splitn(2, '/');
    let first = segments.next().unwrap_or_default();
    let rest = segments.next().unwrap_or_default();
    if first.len() == 3
        && first
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_digit())
        && !rest.is_empty()
    {
        format!("{}/{}", &first[1..], rest)
    } else {
        trimmed.to_string()
    }
}

/// Runtime limits for the HTTP client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub timeout_secs: u64,
    pub max_concurrency: usize,
    pub retries: u32,
    pub cache_size_mb: u64,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        let cfg = PawchiveConfig::default();
        Self {
            timeout_secs: cfg.default_timeout_secs,
            max_concurrency: cfg.default_concurrency,
            retries: cfg.default_retries,
            cache_size_mb: 64,
        }
    }
}

pub const PAGE_SIZE: i64 = 50;
pub const MIN_SEARCH_LEN: usize = 3;
pub const MAX_SEARCH_LEN: usize = 200;

#[cfg(test)]
mod tests {
    use super::PawchiveConfig;

    #[test]
    fn exposes_the_release_version() {
        assert_eq!(
            PawchiveConfig::default().app_version,
            crate::shared::version::APP_VERSION
        );
    }

    #[test]
    fn strips_legacy_storage_prefixes_from_thumbnail_paths() {
        let cfg = PawchiveConfig::default();
        assert!(cfg
            .thumbnail_url("/25f/c7/5fc7af9788a855a7df9cfac586e64f549741796d71ef5e960fc429d04dadefce.jpg")
            .ends_with("/thumbnail/data/5f/c7/5fc7af9788a855a7df9cfac586e64f549741796d71ef5e960fc429d04dadefce.jpg"));
        assert!(cfg
            .thumbnail_url("/16a/08/clip.gif")
            .ends_with("/thumbnail/data/6a/08/clip.gif"));
        assert!(cfg
            .thumbnail_url("/ac/21/clip.png")
            .ends_with("/thumbnail/data/ac/21/clip.png"));
        assert!(cfg
            .thumbnail_url("aa/bb/clip.png")
            .ends_with("/thumbnail/data/aa/bb/clip.png"));
        assert!(cfg
            .thumbnail_url("/abc/21/clip.png")
            .ends_with("/thumbnail/data/abc/21/clip.png"));
    }
}
