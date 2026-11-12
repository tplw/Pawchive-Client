use crate::infra::local_http::LocalMediaServer;
use crate::infra::pawchive_api::ApiClient;
use crate::infra::sqlite::Db;
use crate::shared::config::PawchiveConfig;
use crate::shared::models::{AccountSession, AccountState, AppSettings};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

/// Shared application state managed by Tauri. Everything is cheaply cloneable
/// so background jobs can hold their own handle.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub api: ApiClient,
    pub cfg: PawchiveConfig,
    pub settings: Arc<RwLock<AppSettings>>,
    pub cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub downloads: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub download_gate: Arc<Semaphore>,
    pub http: reqwest::Client,
    pub mega: crate::infra::providers::mega::MegaResolver,
    pub proton: Arc<crate::infra::providers::proton::ProtonResolver>,
    pub remote: Arc<crate::infra::providers::remote::RemoteResolver>,
    pub app_data_dir: PathBuf,
    pub default_download_dir: PathBuf,
    pub media_server: LocalMediaServer,
    pub account: Arc<RwLock<Option<AccountSession>>>,
}

impl AppState {
    pub fn settings(&self) -> AppSettings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn download_dir(&self) -> PathBuf {
        // iOS app data containers are sandboxed and their absolute path can
        // change between installs. Always use the current container instead of
        // a stale path saved in the settings database.
        #[cfg(any(target_os = "ios", target_os = "android"))]
        {
            // Mobile containers can move between installs and their files are
            // not writable through desktop-style folder pickers.
            self.default_download_dir.clone()
        }
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        {
            let configured = self.settings().download_dir;
            if configured.trim().is_empty() {
                self.default_download_dir.clone()
            } else {
                PathBuf::from(configured)
            }
        }
    }

    pub fn account_session(&self) -> Option<AccountSession> {
        self.account.read().ok().and_then(|s| s.clone())
    }

    pub fn account_state(&self) -> AccountState {
        match self.account_session() {
            Some(session) => AccountState {
                logged_in: true,
                username: Some(session.username),
            },
            None => AccountState::default(),
        }
    }

    pub fn set_account(&self, session: Option<AccountSession>) {
        if let Ok(mut current) = self.account.write() {
            *current = session;
        }
    }

    pub fn register_cancel(&self, request_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        if let Ok(mut map) = self.cancellations.lock() {
            if let Some(previous) = map.insert(request_id.to_string(), token.clone()) {
                previous.cancel();
            }
        }
        token
    }

    pub fn finish_cancel(&self, request_id: &str) {
        if let Ok(mut map) = self.cancellations.lock() {
            map.remove(request_id);
        }
    }

    pub fn cancel_request(&self, request_id: &str) -> bool {
        if let Ok(mut map) = self.cancellations.lock() {
            if let Some(token) = map.remove(request_id) {
                token.cancel();
                return true;
            }
        }
        false
    }
}
