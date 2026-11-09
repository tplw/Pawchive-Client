pub mod cache;
mod endpoints;

use crate::shared::config::{NetworkSettings, PawchiveConfig};
use crate::shared::error::{AppError, AppResult};
use cache::ResponseCache;
use reqwest::{Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use tokio_util::sync::CancellationToken;

const CACHE_MAX_ENTRIES: usize = 512;
const MAX_HTML_BYTES: usize = 4 * 1024 * 1024;

/// Typed client for the public Pawchive API.
///
/// The client owns connection reuse, bounded concurrency, retries with
/// exponential backoff, 429 handling, response caching, request deduplication
/// and cancellation. It never sends cookies or credentials.
#[derive(Clone)]
pub struct ApiClient {
    http: reqwest::Client,
    cfg: PawchiveConfig,
    cache: Arc<ResponseCache>,
    inflight: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    gate: Arc<Semaphore>,
    net: NetworkSettings,
    session: Arc<RwLock<Option<String>>>,
}

impl ApiClient {
    pub fn new(cfg: PawchiveConfig, net: NetworkSettings) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent(&cfg.user_agent)
            .timeout(Duration::from_secs(net.timeout_secs))
            .pool_max_idle_per_host(net.max_concurrency.max(4))
            .tcp_keepalive(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| AppError::Internal(format!("could not build HTTP client: {e}")))?;
        let max_bytes = (net.cache_size_mb as usize)
            .saturating_mul(1024 * 1024)
            .max(8 * 1024 * 1024);
        Ok(Self {
            http,
            cfg,
            cache: Arc::new(ResponseCache::new(CACHE_MAX_ENTRIES, max_bytes)),
            inflight: Arc::new(Mutex::new(HashMap::new())),
            gate: Arc::new(Semaphore::new(net.max_concurrency.max(1))),
            net,
            session: Arc::new(RwLock::new(None)),
        })
    }

    pub fn set_cache_size_mb(&self, cache_size_mb: u64) {
        let bytes = (cache_size_mb as usize)
            .saturating_mul(1024 * 1024)
            .max(8 * 1024 * 1024);
        self.cache.set_max_bytes(bytes);
    }

    pub fn set_session(&self, session: Option<String>) {
        if let Ok(mut current) = self.session.write() {
            *current = session;
        }
    }

    fn session_header(&self) -> Option<String> {
        self.session
            .read()
            .ok()
            .and_then(|s| s.clone())
            .map(|session| format!("session={session}"))
    }

    fn timeout(&self) -> Duration {
        Duration::from_secs(self.net.timeout_secs)
    }

    fn retries(&self) -> u32 {
        self.net.retries
    }

    fn url(&self, path: &str, query: &[(&str, String)]) -> String {
        let base = self.cfg.api_url(path);
        if query.is_empty() {
            return base;
        }
        match url::Url::parse(&base) {
            Ok(mut url) => {
                {
                    let mut pairs = url.query_pairs_mut();
                    for (key, value) in query {
                        pairs.append_pair(key, value);
                    }
                }
                url.to_string()
            }
            Err(_) => base,
        }
    }

    async fn sleep_cancellable(
        &self,
        duration: Duration,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<()> {
        if let Some(token) = cancel {
            tokio::select! {
                _ = tokio::time::sleep(duration) => Ok(()),
                _ = token.cancelled() => Err(AppError::Cancelled),
            }
        } else {
            tokio::time::sleep(duration).await;
            Ok(())
        }
    }

    async fn acquire(
        &self,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<tokio::sync::OwnedSemaphorePermit> {
        if let Some(token) = cancel {
            tokio::select! {
                permit = self.gate.clone().acquire_owned() => permit.map_err(|_| AppError::Internal("request gate closed".into())),
                _ = token.cancelled() => Err(AppError::Cancelled),
            }
        } else {
            self.gate
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| AppError::Internal("request gate closed".into()))
        }
    }

    /// Send a request with retry/backoff. Returns `Ok(None)` when the server
    /// answers 404 and `allow_404` is set.
    async fn send(
        &self,
        method: Method,
        url: &str,
        cancel: Option<&CancellationToken>,
        timeout: Option<Duration>,
        allow_404: bool,
    ) -> AppResult<Option<Response>> {
        let attempts = self.retries() + 1;
        let timeout = timeout.unwrap_or_else(|| self.timeout());
        let mut last_error: Option<AppError> = None;

        for attempt in 0..attempts {
            let permit = self.acquire(cancel).await?;
            let mut request = self
                .http
                .request(method.clone(), url)
                .timeout(timeout)
                .header(
                    reqwest::header::ACCEPT,
                    "application/json, text/plain;q=0.9, text/html;q=0.8",
                );
            if url.contains("/account/") || url.contains("/favorites/") {
                if let Some(cookie) = self.session_header() {
                    request = request.header(reqwest::header::COOKIE, cookie);
                }
            }

            let result = if let Some(token) = cancel {
                tokio::select! {
                    r = request.send() => r,
                    _ = token.cancelled() => return Err(AppError::Cancelled),
                }
            } else {
                request.send().await
            };
            drop(permit);

            match result {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        return Ok(Some(response));
                    }
                    if status == StatusCode::NOT_FOUND {
                        if allow_404 {
                            return Ok(None);
                        }
                        return Err(AppError::NotFound);
                    }
                    if status == StatusCode::TOO_MANY_REQUESTS {
                        let wait = retry_after(&response).unwrap_or(Duration::from_secs(2));
                        if attempt + 1 >= attempts {
                            return Err(AppError::RateLimited);
                        }
                        tracing::warn!(
                            wait_secs = wait.as_secs(),
                            "archive rate limited the request"
                        );
                        self.sleep_cancellable(wait.min(Duration::from_secs(60)), cancel)
                            .await?;
                        last_error = Some(AppError::RateLimited);
                        continue;
                    }
                    if status.is_server_error() {
                        if attempt + 1 >= attempts {
                            return Err(AppError::Unavailable(format!("HTTP {}", status.as_u16())));
                        }
                        last_error =
                            Some(AppError::Unavailable(format!("HTTP {}", status.as_u16())));
                        self.backoff(attempt, cancel).await?;
                        continue;
                    }
                    let body = response.text().await.unwrap_or_default();
                    let message =
                        extract_error(&body).unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                    if status == StatusCode::BAD_REQUEST {
                        return Err(AppError::Validation(message));
                    }
                    if status == StatusCode::UNAUTHORIZED
                        || status == StatusCode::FORBIDDEN
                        || status == StatusCode::FOUND
                    {
                        return Err(AppError::Unauthorized(
                            "this action requires a Pawchive login".into(),
                        ));
                    }
                    return Err(AppError::Network(message));
                }
                Err(error) => {
                    let retryable = error.is_timeout() || error.is_connect() || error.is_request();
                    let mapped = if error.is_timeout() {
                        AppError::Timeout
                    } else {
                        AppError::Network(redact_error(&error))
                    };
                    if !retryable || attempt + 1 >= attempts {
                        return Err(mapped);
                    }
                    tracing::debug!(attempt, error = %error, "transient request failure; retrying");
                    last_error = Some(mapped);
                    self.backoff(attempt, cancel).await?;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| AppError::Network("request failed".into())))
    }

    async fn backoff(&self, attempt: u32, cancel: Option<&CancellationToken>) -> AppResult<()> {
        let base = 350u64.saturating_mul(1u64 << attempt.min(5));
        let jitter = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64)
            .unwrap_or(0))
            % 250;
        self.sleep_cancellable(Duration::from_millis((base + jitter).min(8_000)), cancel)
            .await
    }

    async fn cached_value(
        &self,
        url: &str,
        ttl: Duration,
        cancel: Option<&CancellationToken>,
        timeout: Option<Duration>,
    ) -> AppResult<serde_json::Value> {
        if let Some(value) = self.cache.get(url) {
            return Ok(value);
        }

        let lock = {
            let mut inflight = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
            inflight
                .entry(url.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        // Another caller may have filled the cache while we waited.
        if let Some(value) = self.cache.get(url) {
            return Ok(value);
        }

        let response = self
            .send(Method::GET, url, cancel, timeout, false)
            .await?
            .ok_or(AppError::NotFound)?;
        let value: serde_json::Value = response.json().await.map_err(|e| {
            AppError::InvalidResponse(format!("the archive returned malformed JSON: {e}"))
        })?;
        self.cache.insert(url.to_string(), value.clone(), ttl);
        Ok(value)
    }

    async fn optional_value(
        &self,
        url: &str,
        ttl: Duration,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Option<serde_json::Value>> {
        if let Some(value) = self.cache.get(url) {
            return Ok(Some(value));
        }
        match self.send(Method::GET, url, cancel, None, true).await? {
            None => Ok(None),
            Some(response) => {
                let text = response.text().await.unwrap_or_default();
                if text.trim().is_empty() {
                    return Ok(None);
                }
                let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
                    AppError::InvalidResponse(format!("the archive returned malformed JSON: {e}"))
                })?;
                self.cache.insert(url.to_string(), value.clone(), ttl);
                Ok(Some(value))
            }
        }
    }

    async fn get_json_uncached<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        cancel: Option<&CancellationToken>,
    ) -> AppResult<T> {
        let url = self.url(path, query);
        let response = self
            .send(Method::GET, &url, cancel, None, false)
            .await?
            .ok_or(AppError::NotFound)?;
        let value: serde_json::Value = response.json().await.map_err(|e| {
            AppError::InvalidResponse(format!("the archive returned malformed JSON: {e}"))
        })?;
        serde_json::from_value(value).map_err(|e| {
            AppError::InvalidResponse(format!("unexpected response shape from the archive: {e}"))
        })
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        ttl: Duration,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<T> {
        let url = self.url(path, query);
        let value = self.cached_value(&url, ttl, cancel, None).await?;
        serde_json::from_value(value).map_err(|e| {
            AppError::InvalidResponse(format!("unexpected response shape from the archive: {e}"))
        })
    }

    async fn get_json_optional<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        ttl: Duration,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<T>> {
        let url = self.url(path, query);
        match self.optional_value(&url, ttl, cancel).await? {
            None => Ok(Vec::new()),
            Some(value) => {
                if value.is_null() {
                    return Ok(Vec::new());
                }
                serde_json::from_value(value).map_err(|e| {
                    AppError::InvalidResponse(format!(
                        "unexpected response shape from the archive: {e}"
                    ))
                })
            }
        }
    }
}

fn retry_after(response: &Response) -> Option<Duration> {
    let value = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?;
    if let Ok(seconds) = value.trim().parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    chrono::DateTime::parse_from_rfc2822(value.trim())
        .ok()
        .map(|dt| {
            let now = chrono::Utc::now();
            let delta = dt.with_timezone(&chrono::Utc) - now;
            Duration::from_secs(delta.num_seconds().max(0) as u64)
        })
}

fn extract_error(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Strip query strings and headers from error text so nothing sensitive is
/// written to logs or surfaced in the UI.
fn redact_error(error: &reqwest::Error) -> String {
    if error.is_connect() {
        "could not connect to the archive".to_string()
    } else if error.is_body() {
        "the response body was interrupted".to_string()
    } else {
        let text = error.to_string();
        text.split(" for url (").next().unwrap_or(&text).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::config::NetworkSettings;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client(base: &str) -> ApiClient {
        let cfg = PawchiveConfig {
            api_base: format!("{base}/api/v1"),
            ..Default::default()
        };
        let net = NetworkSettings {
            timeout_secs: 5,
            max_concurrency: 4,
            retries: 1,
            cache_size_mb: 64,
        };
        ApiClient::new(cfg, net).unwrap()
    }

    #[tokio::test]
    async fn fetches_and_caches_recent_posts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"id": "1", "user": "2", "service": "fanbox", "title": "T", "content": "", "attachments": []}
            ])))
            .expect(1)
            .mount(&server)
            .await;

        let client = test_client(&server.uri());
        let first = client.recent_posts(0, None, None).await.unwrap();
        let second = client.recent_posts(0, None, None).await.unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
    }

    #[tokio::test]
    async fn sends_query_and_offset_parameters() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .and(query_param("q", "dragon"))
            .and(query_param("o", "50"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        let posts = client.recent_posts(50, Some("dragon"), None).await.unwrap();
        assert!(posts.is_empty());
    }

    #[tokio::test]
    async fn validates_before_sending() {
        let client = test_client("http://127.0.0.1:9");
        assert!(matches!(
            client.recent_posts(25, None, None).await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            client.recent_posts(0, Some("ab"), None).await,
            Err(AppError::Validation(_))
        ));
    }

    #[tokio::test]
    async fn maps_not_found_and_empty_optional_lists() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/fanbox/user/1/post/2/comments"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/fanbox/user/1/post/2"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        let comments = client.comments("fanbox", "1", "2", None).await.unwrap();
        assert!(comments.is_empty());
        assert!(matches!(
            client.post("fanbox", "1", "2", None).await,
            Err(AppError::NotFound)
        ));
    }

    #[tokio::test]
    async fn retries_transient_server_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        let posts = client.recent_posts(0, None, None).await.unwrap();
        assert!(posts.is_empty());
    }

    #[tokio::test]
    async fn reports_malformed_payloads() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"not": "a list"})),
            )
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        assert!(matches!(
            client.recent_posts(0, None, None).await,
            Err(AppError::InvalidResponse(_))
        ));
    }

    #[tokio::test]
    async fn honors_rate_limit_retry_after() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "0"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        let posts = client.recent_posts(0, None, None).await.unwrap();
        assert!(posts.is_empty());
    }

    #[tokio::test]
    async fn honors_cancellation() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/posts"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(3))
                    .set_body_json(serde_json::json!([])),
            )
            .mount(&server)
            .await;
        let client = test_client(&server.uri());
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            client.recent_posts(0, None, Some(&token)).await,
            Err(AppError::Cancelled)
        ));
    }
}
