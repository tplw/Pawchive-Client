use super::{ApiClient, MAX_HTML_BYTES};
use crate::shared::error::{AppError, AppResult};
use crate::shared::models::{
    Announcement, Comment, CreatorProfile, CreatorSummary, Post, Revision,
};
use crate::shared::security::{
    validate_id, validate_offset, validate_search_query, validate_service,
};
use reqwest::Method;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

impl ApiClient {
    pub async fn list_creators(
        &self,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<CreatorSummary>> {
        let url = self.url("creators", &[]);
        let response = self
            .send(
                Method::GET,
                &url,
                cancel,
                Some(Duration::from_secs(240)),
                false,
            )
            .await?
            .ok_or(AppError::NotFound)?;
        let value: serde_json::Value = response.json().await.map_err(|e| {
            AppError::InvalidResponse(format!("could not parse creator index: {e}"))
        })?;
        serde_json::from_value(value)
            .map_err(|e| AppError::InvalidResponse(format!("unexpected creator index shape: {e}")))
    }

    pub async fn recent_posts(
        &self,
        offset: i64,
        query: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Post>> {
        let offset = validate_offset(offset)?;
        let mut params: Vec<(&str, String)> = Vec::new();
        if offset > 0 {
            params.push(("o", offset.to_string()));
        }
        if let Some(q) = query {
            params.push(("q", validate_search_query(q)?));
        }
        self.get_json("posts", &params, Duration::from_secs(45), cancel)
            .await
    }

    pub async fn creator_posts(
        &self,
        service: &str,
        creator_id: &str,
        offset: i64,
        query: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Post>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let offset = validate_offset(offset)?;
        let mut params: Vec<(&str, String)> = Vec::new();
        if offset > 0 {
            params.push(("o", offset.to_string()));
        }
        if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            params.push(("q", validate_search_query(query)?));
        }
        self.get_json(
            &format!("{service}/user/{creator_id}"),
            &params,
            Duration::from_secs(60),
            cancel,
        )
        .await
    }

    /// The archive's "Similar Creators" view is server-rendered. Mirror the
    /// public page and parse its creator cards; there is no JSON endpoint.
    pub async fn similar_creators_html(
        &self,
        service: &str,
        creator_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<String> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let url = format!(
            "{}/{service}/user/{creator_id}/recommended",
            self.cfg.static_base.trim_end_matches('/')
        );
        let response = self
            .send(
                Method::GET,
                &url,
                cancel,
                Some(Duration::from_secs(45)),
                false,
            )
            .await?
            .ok_or(AppError::NotFound)?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_HTML_BYTES as u64)
        {
            return Err(AppError::InvalidResponse(
                "similar creators page is unexpectedly large".into(),
            ));
        }
        let mut response = response;
        let mut body = Vec::new();
        while body.len() < MAX_HTML_BYTES {
            let next = match cancel {
                Some(token) => tokio::select! {
                    _ = token.cancelled() => return Err(AppError::Cancelled),
                    chunk = tokio::time::timeout(Duration::from_secs(30), response.chunk()) => chunk,
                },
                None => tokio::time::timeout(Duration::from_secs(30), response.chunk()).await,
            };
            let chunk = next.map_err(|_| AppError::Timeout)?.map_err(|error| {
                AppError::Network(crate::shared::security::network_error_message(&error))
            })?;
            let Some(chunk) = chunk else {
                break;
            };
            let remaining = MAX_HTML_BYTES - body.len();
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    pub async fn creator_profile(
        &self,
        service: &str,
        creator_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<CreatorProfile> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        self.get_json(
            &format!("{service}/user/{creator_id}/profile"),
            &[],
            Duration::from_secs(300),
            cancel,
        )
        .await
    }

    pub async fn creator_links(
        &self,
        service: &str,
        creator_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<CreatorProfile>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        self.get_json_optional(
            &format!("{service}/user/{creator_id}/links"),
            &[],
            Duration::from_secs(300),
            cancel,
        )
        .await
    }

    pub async fn announcements(
        &self,
        service: &str,
        creator_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Announcement>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        self.get_json_optional(
            &format!("{service}/user/{creator_id}/announcements"),
            &[],
            Duration::from_secs(180),
            cancel,
        )
        .await
    }

    pub async fn post(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Post> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let post_id = validate_id(post_id, "post id")?;
        self.get_json(
            &format!("{service}/user/{creator_id}/post/{post_id}"),
            &[],
            Duration::from_secs(120),
            cancel,
        )
        .await
    }

    pub async fn comments(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Comment>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let post_id = validate_id(post_id, "post id")?;
        self.get_json_optional(
            &format!("{service}/user/{creator_id}/post/{post_id}/comments"),
            &[],
            Duration::from_secs(90),
            cancel,
        )
        .await
    }

    pub async fn revisions(
        &self,
        service: &str,
        creator_id: &str,
        post_id: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<Revision>> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let post_id = validate_id(post_id, "post id")?;
        self.get_json_optional(
            &format!("{service}/user/{creator_id}/post/{post_id}/revisions"),
            &[],
            Duration::from_secs(90),
            cancel,
        )
        .await
    }
    /// The archive's popular-posts page is server-rendered; there is no
    /// documented JSON endpoint. We fetch the official page and parse the
    /// fixed card markup, then enrich it from the local creator index.
    pub async fn popular_posts_html(
        &self,
        offset: i64,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<String> {
        let offset = validate_offset(offset)?;
        let url = format!(
            "{}/posts/popular?o={offset}",
            self.cfg.static_base.trim_end_matches('/')
        );
        let response = self
            .send(
                Method::GET,
                &url,
                cancel,
                Some(Duration::from_secs(30)),
                false,
            )
            .await?
            .ok_or(AppError::NotFound)?;
        response
            .text()
            .await
            .map_err(|e| AppError::Network(format!("could not read popular posts: {e}")))
    }

    /* ------------------------------- account ------------------------------- */

    pub async fn list_account_favorites(
        &self,
        kind: &str,
        cancel: Option<&CancellationToken>,
    ) -> AppResult<Vec<CreatorSummary>> {
        let kind = match kind {
            "artist" | "creator" => "artist",
            "post" => "post",
            _ => return Err(AppError::Validation("invalid favorite type".into())),
        };
        let params = [("type", kind.to_string())];
        self.get_json_uncached("account/favorites", &params, cancel)
            .await
    }

    pub async fn set_account_favorite_creator(
        &self,
        service: &str,
        creator_id: &str,
        favorited: bool,
    ) -> AppResult<()> {
        let service = validate_service(service)?;
        let creator_id = validate_id(creator_id, "creator id")?;
        let method = if favorited {
            Method::POST
        } else {
            Method::DELETE
        };
        let url = self.url(&format!("favorites/creator/{service}/{creator_id}"), &[]);
        self.send(method, &url, None, None, false).await?;
        Ok(())
    }
}
