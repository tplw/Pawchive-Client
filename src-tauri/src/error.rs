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
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Wire {
            code: self.code(),
            message: self.to_string(),
            retryable: self.retryable(),
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
