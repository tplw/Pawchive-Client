use serde::Serialize;

/// A structured, serializable application error.
///
/// Every command returns `Result<T, AppError>` so the frontend always receives
/// a stable `{ code, message, retryable }` object instead of an opaque string.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("network request failed: {0}")]
    Network(String),
    #[error("request timed out")]
    Timeout,
    #[error("the archive is rate limiting requests; try again shortly")]
    RateLimited,
    #[error("remote content was not found")]
    NotFound,
    #[error("the archive returned an invalid response: {0}")]
    InvalidResponse(String),
    #[error("invalid input: {0}")]
    Validation(String),
    #[error("unsupported or disallowed URL: {0}")]
    UnsafeUrl(String),
    #[error("authentication required: {0}")]
    Unauthorized(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("file operation failed: {0}")]
    Io(String),
    #[error("playback failed: {0}")]
    Playback(String),
    #[error("request was cancelled")]
    Cancelled,
    #[error("the archive is currently unavailable: {0}")]
    Unavailable(String),
    #[error("this creator is blocked")]
    Blocked,
    #[error("a password is required for this {provider} link")]
    PasswordRequired {
        provider: &'static str,
        url: String,
        rejected: bool,
    },
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "network",
            Self::Timeout => "timeout",
            Self::RateLimited => "rate_limited",
            Self::NotFound => "not_found",
            Self::InvalidResponse(_) => "invalid_response",
            Self::Validation(_) => "validation",
            Self::UnsafeUrl(_) => "unsafe_url",
            Self::Unauthorized(_) => "unauthorized",
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::Playback(_) => "playback",
            Self::Cancelled => "cancelled",
            Self::Unavailable(_) => "unavailable",
            Self::Blocked => "blocked",
            Self::PasswordRequired { .. } => "password_required",
            Self::Internal(_) => "internal",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::Network(_) | Self::Timeout | Self::RateLimited | Self::Unavailable(_)
        )
    }
}

#[derive(Serialize)]
struct Wire<'a> {
    code: &'a str,
    message: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rejected: Option<bool>,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (provider, url, rejected) = match self {
            Self::PasswordRequired {
                provider,
                url,
                rejected,
            } => (Some(*provider), Some(url.as_str()), Some(*rejected)),
            _ => (None, None, None),
        };
        Wire {
            code: self.code(),
            message: self.to_string(),
            retryable: self.retryable(),
            provider,
            url,
            rejected,
        }
        .serialize(serializer)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::InvalidResponse(value.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(value: url::ParseError) -> Self {
        Self::Validation(format!("malformed URL: {value}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_provider_password_errors() {
        let value = serde_json::to_value(AppError::PasswordRequired {
            provider: "MEGA",
            url: "https://mega.nz/#P!abc".to_string(),
            rejected: true,
        })
        .unwrap();
        assert_eq!(value["code"], "password_required");
        assert_eq!(value["provider"], "MEGA");
        assert_eq!(value["url"], "https://mega.nz/#P!abc");
        assert_eq!(value["rejected"], true);
        assert_eq!(value["retryable"], false);
    }
}
