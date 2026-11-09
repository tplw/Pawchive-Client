use crate::shared::error::{AppError, AppResult};

/// Media paths are relative to the file host (`/ab/cd/<sha>.mp4`).
pub fn validate_relative_path(raw: &str) -> AppResult<String> {
    let path = raw.trim();
    if path.is_empty() {
        return Err(AppError::Validation("file path is empty".into()));
    }
    if path.len() > 1024 {
        return Err(AppError::Validation("file path is too long".into()));
    }
    if !path.starts_with('/') {
        return Err(AppError::Validation("file path must be absolute".into()));
    }
    if path.contains("..") || path.contains('\\') || path.contains("//") {
        return Err(AppError::UnsafeUrl("path traversal is not allowed".into()));
    }
    if path.chars().any(|c| c.is_control()) {
        return Err(AppError::UnsafeUrl(
            "file path contains control characters".into(),
        ));
    }
    if path.contains(':') {
        return Err(AppError::UnsafeUrl(
            "file path may not contain a scheme".into(),
        ));
    }
    Ok(path.to_string())
}

pub fn validate_service(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty() || value.len() > 64 {
        return Err(AppError::Validation("invalid service name".into()));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation("invalid service name".into()));
    }
    Ok(value)
}

pub fn validate_id(raw: &str, label: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 128 {
        return Err(AppError::Validation(format!("invalid {label}")));
    }
    if value.contains('/')
        || value.contains('?')
        || value.contains('#')
        || value.chars().any(|c| c.is_control())
    {
        return Err(AppError::Validation(format!("invalid {label}")));
    }
    Ok(value.to_string())
}

pub fn validate_offset(offset: i64) -> AppResult<i64> {
    if offset < 0 {
        return Err(AppError::Validation("offset must not be negative".into()));
    }
    if offset % 50 != 0 {
        return Err(AppError::Validation(
            "offset must be a multiple of 50".into(),
        ));
    }
    if offset > 1_000_000 {
        return Err(AppError::Validation("offset is too large".into()));
    }
    Ok(offset)
}

pub fn validate_search_query(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    let len = value.chars().count();
    if len < crate::shared::config::MIN_SEARCH_LEN {
        return Err(AppError::Validation(
            "search needs at least 3 characters".into(),
        ));
    }
    if len > crate::shared::config::MAX_SEARCH_LEN {
        return Err(AppError::Validation(
            "search must be 200 characters or fewer".into(),
        ));
    }
    Ok(value.to_string())
}
