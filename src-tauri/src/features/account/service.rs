use crate::app::state::AppState;
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{AccountSession, AccountState};
use crate::shared::task::blocking;
use reqwest::cookie::CookieStore;
use std::sync::Arc;
use std::time::Duration;

fn account_file(state: &AppState) -> std::path::PathBuf {
    state.app_data_dir.join("account.json")
}

pub(crate) fn session_cookie(header: &str) -> Option<String> {
    header.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == "session" && !value.is_empty()).then(|| value.to_string())
    })
}

fn save_account(state: &AppState, session: &AccountSession) -> AppResult<()> {
    let path = account_file(state);
    let raw = serde_json::to_string_pretty(session)
        .map_err(|e| AppError::Internal(format!("could not serialize account: {e}")))?;
    std::fs::write(&path, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Pawchive account login, session and favorite synchronization.
pub(crate) struct AccountService {
    state: AppState,
}

impl AccountService {
    pub(crate) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub(crate) fn state(&self) -> AccountState {
        self.state.account_state()
    }

    pub(crate) async fn login(
        &self,
        username: String,
        password: String,
        remember: Option<bool>,
    ) -> AppResult<AccountState> {
        let username = username.trim().to_string();
        if username.is_empty()
            || username.len() > 200
            || password.is_empty()
            || password.len() > 500
        {
            return Err(AppError::Validation("enter a username and password".into()));
        }
        let jar = Arc::new(reqwest::cookie::Jar::default());
        let client = reqwest::Client::builder()
            .user_agent(&self.state.cfg.user_agent)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(15))
            .cookie_provider(jar.clone())
            .redirect(crate::shared::security::redirect_policy(
                self.state.cfg.allowed_hosts(),
            ))
            .build()
            .map_err(|e| AppError::Internal(format!("could not build login client: {e}")))?;
        let login_url = format!(
            "{}/account/login",
            self.state.cfg.static_base.trim_end_matches('/')
        );
        let response = client
            .post(&login_url)
            .form(&[
                ("username", username.as_str()),
                ("password", password.as_str()),
                ("location", "/"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Network(format!("could not reach Pawchive login: {e}")))?;
        if matches!(
            response.status(),
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
        ) {
            return Err(AppError::Unauthorized(
                "the username or password was rejected".into(),
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::Unauthorized(
                "Pawchive did not accept the login".into(),
            ));
        }
        let parsed = url::Url::parse(&login_url)?;
        let header = jar
            .cookies(&parsed)
            .and_then(|value| value.to_str().ok().map(str::to_string));
        let session = header.as_deref().and_then(session_cookie).ok_or_else(|| {
            AppError::Unauthorized("the username or password was rejected".into())
        })?;

        let previous = self.state.account_session();
        self.state.api.set_session(Some(session.clone()));
        if self
            .state
            .api
            .list_account_favorites("artist", None)
            .await
            .is_err()
        {
            self.state
                .api
                .set_session(previous.as_ref().map(|entry| entry.session.clone()));
            return Err(AppError::Unauthorized(
                "the account session could not be verified".into(),
            ));
        }
        let account = AccountSession { username, session };
        self.state.set_account(Some(account.clone()));
        if remember.unwrap_or(false) {
            save_account(&self.state, &account)?;
        } else {
            let path = account_file(&self.state);
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(self.state.account_state())
    }

    pub(crate) fn logout(&self) -> AppResult<AccountState> {
        self.state.api.set_session(None);
        self.state.set_account(None);
        let path = account_file(&self.state);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(AccountState::default())
    }

    pub(crate) async fn sync_favorites(&self) -> AppResult<u64> {
        if self.state.account_session().is_none() {
            return Err(AppError::Unauthorized("log in to sync favorites".into()));
        }
        let favorites = self
            .state
            .api
            .list_account_favorites("artist", None)
            .await?;
        let db = Arc::clone(&self.state.db);
        let count = favorites.len() as u64;
        blocking(move || {
            for creator in &favorites {
                db.set_favorite_creator(
                    &creator.service,
                    &creator.id,
                    &creator.name,
                    creator.public_id.as_deref(),
                    true,
                )?;
            }
            Ok(())
        })
        .await?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_session_cookie_from_a_cookie_header() {
        assert_eq!(
            session_cookie("__ddg1=abc; session=flask.session.value; other=1").as_deref(),
            Some("flask.session.value")
        );
        assert_eq!(session_cookie("other=1"), None);
        assert_eq!(session_cookie("session="), None);
    }
}
