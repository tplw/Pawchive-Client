use crate::shared::error::{AppError, AppResult};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Passwords for MEGA and Proton public links.
///
/// Session-only passwords stay in memory. Remembered passwords are written to
/// a small app-data JSON file with owner-only permissions on Unix. A wrong
/// password is removed by the provider resolver before the UI asks again.
pub struct ProviderPasswords {
    path: Option<PathBuf>,
    remembered: Mutex<HashMap<String, String>>,
    session: Mutex<HashMap<String, String>>,
}

impl ProviderPasswords {
    pub fn load(path: PathBuf) -> Self {
        let remembered = match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<HashMap<String, String>>(&raw) {
                Ok(entries) => entries,
                Err(error) => {
                    tracing::warn!(%error, "ignoring unreadable provider password store");
                    HashMap::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => {
                tracing::warn!(%error, "could not read provider password store");
                HashMap::new()
            }
        };
        Self {
            path: Some(path),
            remembered: Mutex::new(remembered),
            session: Mutex::new(HashMap::new()),
        }
    }

    pub fn in_memory() -> Self {
        Self {
            path: None,
            remembered: Mutex::new(HashMap::new()),
            session: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        if let Ok(session) = self.session.lock() {
            if let Some(password) = session.get(key) {
                return Some(password.clone());
            }
        }
        self.remembered
            .lock()
            .ok()
            .and_then(|remembered| remembered.get(key).cloned())
    }

    pub fn set(&self, key: &str, password: &str, remember: bool) -> AppResult<()> {
        if password.is_empty() {
            return Err(AppError::Validation(
                "the link password cannot be empty".into(),
            ));
        }
        if password.len() > 2_048 {
            return Err(AppError::Validation("the link password is too long".into()));
        }
        if let Ok(mut session) = self.session.lock() {
            session.insert(key.to_string(), password.to_string());
        }
        let mut remembered = self
            .remembered
            .lock()
            .map_err(|_| AppError::Internal("provider password store is poisoned".into()))?;
        let changed = if remember {
            let changed = remembered.get(key).map(String::as_str) != Some(password);
            remembered.insert(key.to_string(), password.to_string());
            changed
        } else {
            remembered.remove(key).is_some()
        };
        if changed {
            self.persist(&remembered)?;
        }
        Ok(())
    }

    pub fn remove(&self, key: &str) {
        if let Ok(mut session) = self.session.lock() {
            session.remove(key);
        }
        if let Ok(mut remembered) = self.remembered.lock() {
            if remembered.remove(key).is_some() {
                if let Err(error) = self.persist(&remembered) {
                    tracing::warn!(%error, "could not update provider password store");
                }
            }
        }
    }

    fn persist(&self, entries: &HashMap<String, String>) -> AppResult<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(parent)?;
        let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(entries)?;
        std::fs::write(&temp, bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
        }
        if std::fs::rename(&temp, path).is_err() {
            // Windows does not replace an existing destination with rename.
            let _ = std::fs::remove_file(path);
            std::fs::rename(&temp, path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_and_forgets_passwords() {
        let store = ProviderPasswords::in_memory();
        store.set("mega:abc", "first", false).unwrap();
        assert_eq!(store.get("mega:abc").as_deref(), Some("first"));
        store.set("mega:abc", "second", true).unwrap();
        assert_eq!(store.get("mega:abc").as_deref(), Some("second"));
        store.remove("mega:abc");
        assert_eq!(store.get("mega:abc"), None);
    }

    #[test]
    fn rejects_empty_passwords() {
        let store = ProviderPasswords::in_memory();
        assert!(store.set("proton:abc", "", true).is_err());
    }

    #[test]
    fn persists_only_remembered_passwords() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("provider-passwords.json");
        let store = ProviderPasswords::load(path.clone());
        store.set("proton:a", "remember me", true).unwrap();
        store.set("proton:b", "this session only", false).unwrap();

        let reloaded = ProviderPasswords::load(path);
        assert_eq!(reloaded.get("proton:a").as_deref(), Some("remember me"));
        assert_eq!(reloaded.get("proton:b"), None);
    }
}
