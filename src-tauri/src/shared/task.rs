use crate::shared::error::{AppError, AppResult};

/// Run blocking database work off the async runtime, preserving AppError.
pub(crate) async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("background task failed: {e}")))?
}
