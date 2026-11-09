use crate::shared::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub(super) async fn remove_if_inside(root: &Path, path: &Path) {
    let Ok(root) = root.canonicalize() else {
        return;
    };
    let Ok(path) = path.canonicalize() else {
        return;
    };
    if path.starts_with(&root) {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub(super) async fn reserve_unique_path(dir: &Path, name: &str) -> AppResult<(String, PathBuf)> {
    let candidate = if name.trim().is_empty() {
        "media".to_string()
    } else {
        name.to_string()
    };
    let (stem, ext) = split_name(&candidate);
    for index in 0..10_000 {
        let next = if index == 0 {
            candidate.clone()
        } else if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let path = dir.join(&next);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => {
                drop(file);
                return Ok((next, path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::Io(format!(
                    "could not reserve download file: {error}"
                )))
            }
        }
    }
    for _ in 0..10 {
        let next = if ext.is_empty() {
            format!("{stem}-{}", uuid::Uuid::new_v4())
        } else {
            format!("{stem}-{}.{ext}", uuid::Uuid::new_v4())
        };
        let path = dir.join(&next);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => {
                drop(file);
                return Ok((next, path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::Io(format!(
                    "could not reserve download file: {error}"
                )))
            }
        }
    }
    Err(AppError::Io(
        "could not find a unique filename for the download".into(),
    ))
}

pub(super) fn split_name(name: &str) -> (String, String) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            (stem.to_string(), ext.to_string())
        }
        _ => (name.to_string(), String::new()),
    }
}
