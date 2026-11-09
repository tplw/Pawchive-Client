use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};

const UPDATES_API: &str = "https://api.github.com/repos/tplw/Pawchive-Client/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/tplw/Pawchive-Client/releases";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub url: String,
    pub release_name: Option<String>,
}

/// Parse a release version with two to four numeric segments. Release tags
/// such as `v1.0.3.1` are valid Pawchive versions even though Cargo and Tauri
/// only accept three numeric segments.
pub(crate) fn parse_version(input: &str) -> AppResult<Vec<u64>> {
    let raw = input.trim().trim_start_matches('v');
    let core = raw.split(['-', '+']).next().unwrap_or(raw);
    let mut parts = Vec::new();
    for part in core.split('.') {
        parts.push(
            part.parse::<u64>()
                .map_err(|_| AppError::InvalidResponse(format!("invalid version: {input}")))?,
        );
    }
    if !(2..=4).contains(&parts.len()) {
        return Err(AppError::InvalidResponse(format!(
            "invalid version: {input}"
        )));
    }
    while parts.len() < 4 {
        parts.push(0);
    }
    Ok(parts)
}

pub(crate) fn is_newer_version(current: &str, latest: &str) -> AppResult<bool> {
    Ok(parse_version(latest)? > parse_version(current)?)
}

/// GitHub release check behind the update command.
pub(crate) struct UpdateService {
    state: AppState,
}

impl UpdateService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) async fn check(&self) -> AppResult<UpdateInfo> {
        let response = self
            .state
            .http
            .get(UPDATES_API)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| AppError::Network(format!("could not check for updates: {e}")))?;

        if response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            return Err(AppError::Unavailable(
                "GitHub is rate limiting update checks; try again later".into(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Unavailable(format!(
                "update service returned {}",
                response.status()
            )));
        }

        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppError::InvalidResponse(format!("invalid update response: {e}")))?;
        let latest = payload
            .get("tag_name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| AppError::InvalidResponse("release has no tag name".into()))?;
        let latest = latest.trim_start_matches('v');
        let update_available = is_newer_version(crate::shared::version::APP_VERSION, latest)?;
        let url = payload
            .get("html_url")
            .and_then(|value| value.as_str())
            .filter(|url| url.starts_with("https://github.com/tplw/Pawchive-Client/releases/"))
            .unwrap_or(RELEASES_PAGE);
        let release_name = payload
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::to_string);

        Ok(UpdateInfo {
            current_version: crate::shared::version::APP_VERSION.to_string(),
            latest_version: latest.to_string(),
            update_available,
            url: url.to_string(),
            release_name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_release_versions() {
        assert!(is_newer_version("1.0.1", "1.0.2").unwrap());
        assert!(is_newer_version("1.0.1", "v1.0.2").unwrap());
        assert!(!is_newer_version("1.0.2", "1.0.2").unwrap());
        assert!(!is_newer_version("1.0.2", "1.0.1").unwrap());
        assert!(is_newer_version("1.0.2", "not-a-version").is_err());
    }

    #[test]
    fn compares_four_part_release_versions() {
        assert!(is_newer_version("1.0.3", "1.0.3.1").unwrap());
        assert!(is_newer_version("1.0.3.1", "v1.0.4").unwrap());
        assert!(!is_newer_version("1.0.3.1", "v1.0.3.1").unwrap());
        assert!(!is_newer_version("1.0.4", "v1.0.3.1").unwrap());
        assert!(!is_newer_version("1.0.3.1", "1.0.3").unwrap());
    }
}
